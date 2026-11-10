"""Tareas de mantenimiento."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tirds.db import models as m
from tirds.sources.dgcp.sync import CONTRACT_PRESERVE, PROCESS_PRESERVE
from tirds.transform.parse import content_hash
from tirds.transform.upsert import VOLATILE

TRACKED: dict[str, tuple[type[m.Base], frozenset[str]]] = {
    "institutions": (m.Institution, frozenset()),
    "suppliers": (m.Supplier, frozenset()),
    "procurement_processes": (m.ProcurementProcess, PROCESS_PRESERVE),
    "contracts": (m.Contract, CONTRACT_PRESERVE),
    "bids": (m.Bid, frozenset()),
    "investment_projects": (m.InvestmentProject, frozenset()),
}


def rehash(session: Session, table: str, batch: int = 5000) -> int:
    """Recalcula content_hash desde los valores guardados (tras cambiar reglas de mapeo).
    Evita que un cambio de formato se registre como modificación en origen."""
    model, preserve = TRACKED[table]
    cols = [c.key for c in model.__table__.columns if c.key not in VOLATILE and c.key not in preserve]  # type: ignore[attr-defined]
    last_id, n = 0, 0
    while True:
        rows = session.execute(
            select(model.id, *[getattr(model, c) for c in cols])
            .where(model.id > last_id)  # type: ignore[attr-defined]
            .order_by(model.id)
            .limit(batch)  # type: ignore[attr-defined]
        ).all()
        if not rows:
            return n
        updates: list[dict[str, Any]] = []
        for r in rows:
            values = dict(zip(cols, r[1:], strict=True))
            updates.append({"id": r[0], "content_hash": content_hash(values)})
        session.execute(update(model), updates)
        session.commit()
        last_id = rows[-1][0]
        n += len(rows)


def prune(session: Session, keep_months: int) -> dict[str, int]:
    """Ventana móvil para caber en el plan gratuito: elimina compras más antiguas que
    `keep_months`, EXCEPTO las que sustentan alguna alerta (cualquier estado), para que
    los enlaces permanentes y su evidencia sigan funcionando."""
    from sqlalchemy import text

    params = {"months": keep_months}
    cutoff = "now() - make_interval(months => :months)"
    out: dict[str, int] = {}
    out["contratos"] = (
        session.execute(
            text(f"""
        DELETE FROM contracts c
        WHERE coalesce(c.awarded_at, c.created_at_source) < {cutoff}
          AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.contract_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.process_id = c.process_id)
    """),
            params,
        ).rowcount
        or 0
    )
    out["ofertas"] = (
        session.execute(
            text(f"""
        DELETE FROM bids b USING procurement_processes p
        WHERE b.process_id = p.id AND p.published_at < {cutoff}
          AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.process_id = p.id)
    """),
            params,
        ).rowcount
        or 0
    )
    out["procesos"] = (
        session.execute(
            text(f"""
        DELETE FROM procurement_processes p
        WHERE p.published_at < {cutoff}
          AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.process_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.process_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.process_id = p.id)
    """),
            params,
        ).rowcount
        or 0
    )
    session.execute(
        text("""
        DELETE FROM record_versions rv WHERE
          (rv.entity = 'contract' AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = rv.entity_id)) OR
          (rv.entity = 'process' AND NOT EXISTS (SELECT 1 FROM procurement_processes p WHERE p.id = rv.entity_id)) OR
          (rv.entity = 'bid' AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.id = rv.entity_id))
    """)
    )
    session.execute(
        text(
            "DELETE FROM search_entries si WHERE si.entity_type = 'proceso' AND NOT EXISTS "
            "(SELECT 1 FROM procurement_processes p WHERE p.id = si.entity_id)"
        )
    )
    session.commit()
    return out
