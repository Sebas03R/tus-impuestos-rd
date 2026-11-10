"""MapaInversiones (datos abiertos CSV, actualización diaria).

Archivos verificados el 2026-11-09 en https://mapainversiones.gob.do/DatosAbiertos:
proyectos, territorio (región/provincia/municipio, sin coordenadas), fuentes de financiamiento,
contratos y procesos por proyecto (vínculo SNIP verificable), presupuesto de inversión (Hacienda).
"""

from __future__ import annotations

import csv
import io
from collections import Counter, defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tirds.config import get_settings
from tirds.db import models as m
from tirds.db.session import advisory_lock, session_scope
from tirds.http import PoliteClient
from tirds.runs import RunContext, sync_run
from tirds.snapshots import SnapshotWriter
from tirds.transform.parse import clean_text, content_hash, to_date, to_datetime, to_decimal
from tirds.transform.upsert import Counts, upsert_tracked

log = structlog.get_logger()
SOURCE = "mapainversiones"

FILES = {
    "proyectos": "DatosAbiertosProyectosDeInversion.csv",
    "territorio": "DatosAbiertosProyectosDeInversionXTerritorio.csv",
    "financiamiento": "DatosAbiertosProyectosDeInversionXFuenteFinanciacion.csv",
    "contratos": "DatosAbiertosContratosXProyectosInv.csv",
    "procesos": "DatosAbiertosProcesosXProyectosInv.csv",
    "presupuesto": "DatosabiertosPresupuestoHacienda.csv",
}


def fetch_csv(client: PoliteClient, ctx: RunContext, name: str) -> list[dict[str, str]]:
    url = f"{get_settings().mapainversiones_base_url.rstrip('/')}/{FILES[name]}"
    before = client.requests_made
    response = client.request(url)
    ctx.requests += client.requests_made - before
    text = response.content.decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    with SnapshotWriter(ctx.session, ctx.run.id, SOURCE, name) as snap:
        snap.write(rows)
    return rows


def pct(value: Any) -> Decimal | None:
    d = to_decimal(value)
    return d if d is not None and Decimal(0) <= d <= Decimal(100) else None


def sync_projects(session: Session, client: PoliteClient, ctx: RunContext) -> dict[str, int]:
    projects = fetch_csv(client, ctx, "proyectos")
    funding: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in fetch_csv(client, ctx, "financiamiento"):
        funding[f["IdProyecto"]].append(
            {
                "organismo": clean_text(f.get("OrganismoFinanciador")),
                "fuente": clean_text(f.get("FuenteFinanciacion")),
                "vigente": str(to_decimal(f.get("ValorVigente"))),
                "ejecutado": str(to_decimal(f.get("ValorEjecutado"))),
                "periodo": clean_text(f.get("Periodo")),
            }
        )
    rows = []
    for p in projects:
        key = clean_text(p.get("IdProyecto"))
        name = clean_text(p.get("NombreProyecto"))
        if not key or not name:
            ctx.counts.invalid += 1
            continue
        rows.append(
            {
                "source_key": key,
                "snip_code": clean_text(p.get("CodigoSNIP")),
                "name": name,
                "status": clean_text(p.get("EstadoProyecto")),
                "project_value": to_decimal(p.get("ValorDelProyecto")),
                "currency": "DOP",
                "sector": clean_text(p.get("NombreSector")),
                "executing_entity_code": clean_text(p.get("IdEntidadEjecutora")),
                "executing_entity": clean_text(p.get("EntidadEjecutora")),
                "start_date": to_date(p.get("FechaInicioProyecto")),
                "end_date": to_date(p.get("FechaFinProyecto")),
                # No se inventan avances: fuera de 0–100 o vacío ⇒ NULL
                "physical_progress_pct": pct(p.get("AvanceFisico")),
                "financial_progress_pct": pct(p.get("AvanceFinanciero")),
                "objective": clean_text(p.get("ObjetivoGeneral")),
                "project_type": clean_text(p.get("TipoProyecto")),
                "source_name": clean_text(p.get("NombreFuente")),
                "source_cut_at": to_datetime(p.get("FechaCorteFuente")),
                "funding": sorted(funding.get(key, []), key=lambda x: (x["periodo"] or "", x["fuente"] or "")) or None,
            }
        )
    counts = Counts(fetched=len(projects))
    ids: dict[Any, int] = {}
    for i in range(0, len(rows), 1000):
        c, part = upsert_tracked(
            session, m.InvestmentProject, "source_key", rows[i : i + 1000], "investment_project", ctx.run.id
        )
        counts.add(c)
        ids.update(part)
    ctx.record(counts)
    session.commit()

    # Territorio: se reemplaza completo (el archivo es una foto del estado actual).
    terr = fetch_csv(client, ctx, "territorio")
    loc_rows = []
    seen = set()
    for t in terr:
        pid = ids.get(clean_text(t.get("IdProyecto")))
        if pid is None:
            continue
        region_code = clean_text(t.get("IdRegion")) or ""
        national = region_code == "00" or (clean_text(t.get("NombreRegion")) or "").upper().startswith("NACIONAL")
        key = (pid, clean_text(t.get("IdDepartamento")), clean_text(t.get("IdMunicipio")))
        if key in seen:
            continue
        seen.add(key)
        loc_rows.append(
            {
                "project_id": pid,
                "region": clean_text(t.get("NombreRegion")),
                "province_code": key[1],
                "province": None if national else clean_text(t.get("NombreDepartamento")),
                "municipality_code": key[2],
                "municipality": None if national else clean_text(t.get("NombreMunicipio")),
                "is_national": national,
            }
        )
    session.execute(delete(m.ProjectLocation))
    for i in range(0, len(loc_rows), 2000):
        session.execute(insert(m.ProjectLocation), loc_rows[i : i + 2000])
    session.commit()

    # Vínculos verificables proyecto ↔ proceso/contrato (por SNIP publicado por MapaInversiones).
    by_snip: dict[str, list[int]] = defaultdict(list)
    for r in rows:
        if r["snip_code"] and r["source_key"] in ids:
            by_snip[r["snip_code"]].append(ids[r["source_key"]])
    links = []
    for c in fetch_csv(client, ctx, "contratos"):
        for pid in by_snip.get(clean_text(c.get("CodigoSnip")) or "", []):
            links.append(
                {
                    "project_id": pid,
                    "process_code": clean_text(c.get("CodigoProceso")),
                    "contract_code": clean_text(c.get("CodigoContrato")),
                    "link_source": "mapainversiones_contratos",
                    "amount": to_decimal(c.get("ValorContrato")),
                    "currency": clean_text(c.get("MonedaContrato")),
                    "supplier_name": clean_text(c.get("Proveedor")),
                    "description": clean_text(c.get("DescripcionContrato")),
                }
            )
    for pr in fetch_csv(client, ctx, "procesos"):
        for pid in by_snip.get(clean_text(pr.get("CodigoSnip")) or "", []):
            links.append(
                {
                    "project_id": pid,
                    "process_code": clean_text(pr.get("CodigoProceso")),
                    "contract_code": None,
                    "link_source": "mapainversiones_procesos",
                    "amount": to_decimal(pr.get("MontoEstimado")),
                    "currency": "DOP",
                    "supplier_name": None,
                    "description": clean_text(pr.get("DescripcionProceso")),
                }
            )
    uniq = {(link["project_id"], link["process_code"], link["contract_code"], link["link_source"]): link for link in links}
    session.execute(delete(m.ProjectProcurementLink))
    vals = list(uniq.values())
    for i in range(0, len(vals), 2000):
        session.execute(insert(m.ProjectProcurementLink), vals[i : i + 2000])
    session.commit()
    return {"proyectos": len(rows), "ubicaciones": len(loc_rows), "vinculos": len(vals)}


BUDGET_KEYS = [
    "Año",
    "CodigoInstitucion",
    "TipoGasto",
    "CodigoFuenteDeFinanciamiento",
    "CodigoFuenteEspecifica",
    "CodigoOrganismoFinanciador",
    "CodigoPrograma",
    "CodigoSubPrograma",
    "CodigoSnip",
    "CodigoProyecto",
    "CodigoActividadObra",
    "CodigoObjetoDeGasto",
    "CodigoSubFuncion",
]


def sync_investment_budget(session: Session, client: PoliteClient, ctx: RunContext) -> int:
    rows = fetch_csv(client, ctx, "presupuesto")
    occ: Counter[str] = Counter()
    values = []
    now = datetime.now(UTC)
    for r in rows:
        year = to_decimal(r.get("Año"))
        if year is None:
            ctx.counts.invalid += 1
            continue
        key = content_hash({k: r.get(k) for k in BUDGET_KEYS})
        occ[key] += 1
        values.append(
            {
                "universe": "inversion_mapainversiones",
                "row_hash": f"{key[:56]}-{occ[key]}",
                "year": int(year),
                "institution_code": clean_text(r.get("CodigoInstitucion")),
                "institution_name": clean_text(r.get("Institucion")),
                "expense_type": clean_text(r.get("TipoGasto")),
                "funding_source": clean_text(r.get("FuenteDeFinanciamiento")),
                "program": clean_text(r.get("Programa")),
                "project_name": clean_text(r.get("Proyecto")),
                "snip_code": clean_text(r.get("CodigoSnip")),
                "object_code": clean_text(r.get("CodigoObjetoDeGasto")),
                "object_name": clean_text(r.get("ObjetoDeGasto")),
                "function_name": clean_text(r.get("SubFuncion")),
                "sector": clean_text(r.get("Sector")),
                "approved": to_decimal(r.get("ValorAprobado")),
                "current": to_decimal(r.get("ValorVigente")),
                "accrued": to_decimal(r.get("ValorEjecutado")),
                "paid": None,
                "currency": "DOP",
                "classification": {
                    "finalidad": clean_text(r.get("Finalidad")),
                    "grupo_gasto": clean_text(r.get("Grupodegasto")),
                    "organismo_financiador": clean_text(r.get("OrganismoFinanciador")),
                    "actividad_obra": clean_text(r.get("ActividadObra")),
                    "nota_ejecutado": "ValorEjecutado según MapaInversiones/Hacienda",
                },
                "source_updated_at": to_date(r.get("FechaActualizacionFuente")),
                "last_seen_at": now,
            }
        )
    replace_universe(session, "inversion_mapainversiones", values)
    ctx.counts.fetched += len(rows)
    ctx.counts.new += len(values)
    session.commit()
    return len(values)


def replace_universe(session: Session, universe: str, values: list[dict[str, Any]]) -> None:
    """El archivo es una foto completa: se insertan/actualizan sus filas y se eliminan las ausentes."""
    for i in range(0, len(values), 2000):
        stmt = insert(m.BudgetRecord).values(values[i : i + 2000])
        cols = [k for k in values[0] if k not in ("universe", "row_hash")]
        stmt = stmt.on_conflict_do_update(index_elements=["universe", "row_hash"], set_={c: stmt.excluded[c] for c in cols})
        session.execute(stmt)
    keep = {v["row_hash"] for v in values}
    existing = session.execute(
        select(m.BudgetRecord.id, m.BudgetRecord.row_hash).where(m.BudgetRecord.universe == universe)
    ).all()
    stale = [i for i, h in existing if h not in keep]
    for i in range(0, len(stale), 5000):
        session.execute(delete(m.BudgetRecord).where(m.BudgetRecord.id.in_(stale[i : i + 5000])))


def run_mapainversiones(trigger: str = "cron") -> dict[str, Any]:
    with advisory_lock("mapainversiones") as locked, session_scope() as session:
        if not locked:
            return {"estado": "omitido"}
        with sync_run(session, SOURCE, "mapainversiones", trigger=trigger) as ctx, PoliteClient() as client:
            out: dict[str, Any] = {}
            try:
                out.update(sync_projects(session, client, ctx))
            except Exception as exc:
                session.rollback()
                ctx.error(f"proyectos: {type(exc).__name__}: {exc}")
            try:
                out["presupuesto_inversion"] = sync_investment_budget(session, client, ctx)
            except Exception as exc:
                session.rollback()
                ctx.error(f"presupuesto: {type(exc).__name__}: {exc}")
            from tirds.publish.search_index import refresh_search_index

            refresh_search_index(session, "-infinity")
            log.info("mapainversiones_done", **{k: v for k, v in out.items()})
            return out
