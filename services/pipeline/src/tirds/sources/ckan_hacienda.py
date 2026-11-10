"""Ejecución del gasto (Ministerio de Hacienda) vía la API CKAN de datos.gob.do.

Conjunto verificado: "Estadísticas de Ejecución de los Gastos y Aplicaciones Financieras"
(slug real `estadisticas-de-solicitudes-de-exequatur`), CSV mensual 2017–2025 por institución y
por función. Se agrega a totales ANUALES; los universos se guardan por separado y nunca se suman.
Las URL de los archivos cambian con cada carga: se resuelven con package_show en cada ejecución.
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy.orm import Session

from tirds.config import get_settings
from tirds.db.session import advisory_lock, session_scope
from tirds.http import PoliteClient, SourceUnavailable
from tirds.runs import RunContext, sync_run
from tirds.sources.mapainversiones import replace_universe
from tirds.transform.parse import clean_text, content_hash, to_decimal

log = structlog.get_logger()
SOURCE = "hacienda_ckan"
DATASET = "estadisticas-de-solicitudes-de-exequatur"


def resolve_resources(client: PoliteClient, ctx: RunContext) -> dict[str, str]:
    base = get_settings().ckan_base_url.rstrip("/")
    before = client.requests_made
    data = client.get_json(f"{base}/package_show", params={"id": DATASET})
    ctx.requests += client.requests_made - before
    if not data.get("success"):
        raise SourceUnavailable("CKAN package_show sin éxito")
    out = {}
    for r in data["result"].get("resources", []):
        name = (r.get("name") or "").lower()
        if (r.get("format") or "").upper() != "CSV":
            continue
        if "instituci" in name:
            out["institucion"] = r["url"]
        elif "funci" in name:
            out["funcion"] = r["url"]
    return out


def _amount(value: str | None) -> tuple[Decimal | None, bool]:
    """Devuelve (monto, aproximado). La fuente trae algunos montos en notación científica
    con solo 6 cifras significativas: se conservan pero se marcan como aproximados."""
    text = (value or "").strip()
    return to_decimal(text), ("E" in text.upper())


def load_rows(client: PoliteClient, ctx: RunContext, url: str) -> list[dict[str, str]]:
    before = client.requests_made
    response = client.request(url)
    ctx.requests += client.requests_made - before
    text = response.content.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def aggregate(rows: list[dict[str, str]], keys: list[tuple[str, str]], universe: str) -> list[dict[str, Any]]:
    groups: dict[tuple[str, ...], dict[str, Any]] = {}
    sums: dict[tuple[str, ...], dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    approx: dict[tuple[str, ...], bool] = defaultdict(bool)
    for r in rows:
        year = clean_text(r.get("Período"))
        if not year or not year.isdigit():
            continue
        k = (year, clean_text(r.get("Cod.Ref Inst Seccion")) or "", *[(clean_text(r.get(code)) or "") for code, _ in keys])
        groups.setdefault(
            k,
            {
                "year": int(year),
                "section_code": clean_text(r.get("Cod.Ref Inst Seccion")),
                "section": clean_text(r.get("Ref Inst Seccion")),
                **{label: clean_text(r.get(label_col)) for (_, label_col), label in zip(keys, ("n1", "n2"), strict=False)},
            },
        )
        for col, name in (
            ("Pres. Inicial", "approved"),
            ("Pres. Vigente Aprobado", "current"),
            ("Devengado Aprobado", "accrued"),
        ):
            value, is_approx = _amount(r.get(col))
            if value is not None:
                sums[k][name] += value
            approx[k] |= is_approx
    now = datetime.now(UTC)
    out = []
    for k, g in groups.items():
        s = sums[k]
        out.append(
            {
                "universe": universe,
                "row_hash": content_hash({"k": list(k)})[:60],
                "year": g["year"],
                "period": "anual",
                "institution_code": k[2] if universe.endswith("institucion") else None,
                "institution_name": g.get("n1") if universe.endswith("institucion") else None,
                "expense_type": None,
                "funding_source": None,
                "program": None,
                "project_name": None,
                "snip_code": None,
                "object_code": None,
                "object_name": None,
                "function_name": g.get("n2") if universe.endswith("funcion") else None,
                "sector": g.get("n1") if universe.endswith("funcion") else None,
                "approved": s.get("approved"),
                "current": s.get("current"),
                "accrued": s.get("accrued"),
                "paid": None,
                "currency": "DOP",
                "classification": {
                    "seccion_codigo": g["section_code"],
                    "seccion": g["section"],
                    "codigos": list(k[2:]),
                    "montos_aproximados_en_fuente": approx[k],
                    "nota": "Suma de registros mensuales; 'accrued' = Devengado Aprobado",
                },
                "source_updated_at": None,
                "last_seen_at": now,
            }
        )
    return out


def run_hacienda(trigger: str = "cron") -> dict[str, Any]:
    with advisory_lock("hacienda") as locked, session_scope() as session:
        if not locked:
            return {"estado": "omitido"}
        with sync_run(session, SOURCE, "hacienda_ejecucion", trigger=trigger) as ctx, PoliteClient() as client:
            urls = resolve_resources(client, ctx)
            out: dict[str, Any] = {"recursos": urls}
            for kind, keys, universe in (
                ("institucion", [("Cod.Capí\xadtulo", "Capí\xadtulo")], "ejecucion_hacienda_institucion"),
                (
                    "funcion",
                    [
                        ("Cod.Ref Funcion Finalidad", "Ref Funcion Finalidad"),
                        ("Cod.Ref Funcion Funcion", "Ref Funcion Funcion"),
                    ],
                    "ejecucion_hacienda_funcion",
                ),
            ):
                if kind not in urls:
                    ctx.error(f"No se encontró el recurso CSV '{kind}' en CKAN")
                    continue
                try:
                    rows = load_rows(client, ctx, urls[kind])
                    keys = _fix_keys(rows, keys)
                    values = aggregate(rows, keys, universe)
                    replace_universe(session, universe, values)
                    session.commit()
                    ctx.counts.fetched += len(rows)
                    ctx.counts.new += len(values)
                    out[universe] = len(values)
                except SourceUnavailable as exc:
                    session.rollback()
                    ctx.error(f"{kind}: {exc}")
            return out


def _fix_keys(rows: list[dict[str, str]], keys: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Las cabeceras traen caracteres invisibles (p. ej. 'Capí­tulo' con guion suave)."""
    if not rows:
        return keys
    cols = list(rows[0].keys())

    def find(name: str) -> str:
        if name in cols:
            return name
        plain = name.replace("\xad", "")
        for c in cols:
            if c.replace("\xad", "") == plain:
                return c
        return name

    return [(find(a), find(b)) for a, b in keys]


def _unused(session: Session) -> None:  # pragma: no cover - mantiene la firma pública estable
    return None
