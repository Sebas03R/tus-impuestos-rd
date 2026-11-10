"""Persistencia idempotente con detección de cambios.

- Registros nuevos: se insertan con first_seen_at = ahora.
- Registros cambiados (hash distinto): se actualizan y se guarda el diff en record_versions.
- Registros sin cambios: solo se actualiza last_seen_at.
Correr dos veces la misma carga produce exactamente el mismo estado.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tirds.db.models import Base, RecordVersion
from tirds.transform.parse import content_hash, line_hash, stable_json

VOLATILE = {"id", "content_hash", "first_seen_at", "last_seen_at", "last_changed_at", "is_demo"}


@dataclass
class Counts:
    fetched: int = 0
    new: int = 0
    changed: int = 0
    unchanged: int = 0
    invalid: int = 0
    duplicates: int = 0
    unknown_fields: Counter[str] = field(default_factory=Counter)

    def add(self, other: Counts) -> None:
        self.fetched += other.fetched
        self.new += other.new
        self.changed += other.changed
        self.unchanged += other.unchanged
        self.invalid += other.invalid
        self.duplicates += other.duplicates
        self.unknown_fields.update(other.unknown_fields)


def _jsonable(value: Any) -> Any:
    import json

    return json.loads(stable_json(value))


def upsert_tracked(
    session: Session,
    model: type[Base],
    key_attr: str,
    rows: list[dict[str, Any]],
    entity: str,
    sync_run_id: int | None,
    preserve: frozenset[str] = frozenset(),
) -> tuple[Counts, dict[Any, int]]:
    """Upsert por clave natural. `preserve` = columnas que no se sobrescriben si ya existen
    (p. ej. datos enriquecidos por otra fuente)."""
    counts = Counts()
    if not rows:
        return counts, {}

    by_key: dict[Any, dict[str, Any]] = {}
    for row in rows:
        key = row[key_attr]
        if key in by_key:
            counts.duplicates += 1
        by_key[key] = row
    for row in by_key.values():
        hashed = {k: v for k, v in row.items() if k not in VOLATILE and k not in preserve}
        row["content_hash"] = content_hash(hashed)

    key_col = getattr(model, key_attr)
    id_col = model.id  # type: ignore[attr-defined]
    existing = {
        k: (i, h)
        for k, i, h in session.execute(
            select(key_col, id_col, model.content_hash).where(key_col.in_(list(by_key)))  # type: ignore[attr-defined]
        )
    }
    now = datetime.now(UTC)
    ids: dict[Any, int] = {k: v[0] for k, v in existing.items()}

    new_rows = [r for k, r in by_key.items() if k not in existing]
    if new_rows:
        stmt = insert(model).values(new_rows).on_conflict_do_nothing(index_elements=[key_attr]).returning(key_col, id_col)
        for k, i in session.execute(stmt):
            ids[k] = i
        counts.new += len(new_rows)

    changed_keys = [k for k, r in by_key.items() if k in existing and existing[k][1] != r["content_hash"]]
    unchanged_ids = [existing[k][0] for k, r in by_key.items() if k in existing and existing[k][1] == r["content_hash"]]

    if changed_keys:
        cols = [c for c in by_key[changed_keys[0]] if c not in VOLATILE and c not in preserve]
        old_rows = {
            row[0]: row[1:]
            for row in session.execute(select(key_col, *[getattr(model, c) for c in cols]).where(key_col.in_(changed_keys)))
        }
        versions = []
        updates = []
        for k in changed_keys:
            new = by_key[k]
            old_vals = dict(zip(cols, old_rows.get(k, ()), strict=False))
            diff = {
                c: [_jsonable(old_vals.get(c)), _jsonable(new.get(c))]
                for c in cols
                if stable_json(old_vals.get(c)) != stable_json(new.get(c))
            }
            versions.append(
                {
                    "entity": entity,
                    "entity_id": existing[k][0],
                    "source_key": str(k),
                    "sync_run_id": sync_run_id,
                    "previous_hash": existing[k][1],
                    "new_hash": new["content_hash"],
                    "changed_fields": diff,
                }
            )
            payload = {c: new[c] for c in cols}
            payload.update(id=existing[k][0], content_hash=new["content_hash"], last_seen_at=now, last_changed_at=now)
            updates.append(payload)
        session.execute(update(model), updates)
        session.execute(insert(RecordVersion), versions)
        counts.changed += len(changed_keys)

    if unchanged_ids:
        # Como mucho una vez al día: reescribir filas sin cambios en cada pasada infla la base
        # (MVCC) y el plan gratuito mide el tamaño en disco.
        session.execute(
            update(model)
            .where(id_col.in_(unchanged_ids), model.last_seen_at < func.now() - text("interval '1 day'"))  # type: ignore[attr-defined]
            .values(last_seen_at=func.now())
        )
        counts.unchanged += len(unchanged_ids)
    return counts, ids


def with_line_keys(rows: list[dict[str, Any]], parent_attr: str) -> list[dict[str, Any]]:
    """Asigna line_hash + occurrence a líneas sin identificador de origen.
    Dos líneas idénticas del mismo padre son legítimas: se distinguen por occurrence."""
    seen: Counter[tuple[Any, str]] = Counter()
    out = []
    for row in rows:
        body = {k: v for k, v in row.items() if k not in {parent_attr, "line_hash", "occurrence"}}
        h = line_hash(body)
        seen[(row[parent_attr], h)] += 1
        out.append({**row, "line_hash": h, "occurrence": seen[(row[parent_attr], h)]})
    return out


def insert_lines(session: Session, model: type[Base], parent_attr: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    stmt = (
        insert(model)
        .values(rows)
        .on_conflict_do_nothing(index_elements=[parent_attr, "line_hash", "occurrence"])
        .returning(model.id)  # type: ignore[attr-defined]
    )
    return len(session.execute(stmt).all())


def replace_lines(
    session: Session,
    model: type[Base],
    parent_attr: str,
    parent_id: int,
    rows: list[dict[str, Any]],
) -> tuple[int, int]:
    """Sincroniza el conjunto completo de líneas de un padre. Devuelve (insertadas, eliminadas)."""
    parent_col = getattr(model, parent_attr)
    current = {
        (h, o): i
        for i, h, o in session.execute(
            select(model.id, model.line_hash, model.occurrence).where(parent_col == parent_id)  # type: ignore[attr-defined]
        )
    }
    wanted = {(r["line_hash"], r["occurrence"]) for r in rows}
    stale = [i for key, i in current.items() if key not in wanted]
    if stale:
        session.execute(model.__table__.delete().where(model.__table__.c.id.in_(stale)))  # type: ignore[attr-defined]
    inserted = insert_lines(
        session, model, parent_attr, [r for r in rows if (r["line_hash"], r["occurrence"]) not in current]
    )
    return inserted, len(stale)
