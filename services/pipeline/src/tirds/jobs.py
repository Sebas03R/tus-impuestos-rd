"""Trabajos programables. Cada paso se aísla: un fallo no detiene los demás."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text

from tirds.config import get_settings
from tirds.db.session import advisory_lock, session_scope
from tirds.http import PoliteClient
from tirds.publish.search_index import refresh_search_index
from tirds.runs import RunContext, sync_run
from tirds.sources.dgcp.sync import DgcpSync, PageWalk

log = structlog.get_logger()


def _step(ctx: RunContext, name: str, fn: Callable[[], Any]) -> None:
    try:
        fn()
    except Exception as exc:  # aislar pasos
        ctx.session.rollback()
        ctx.error(f"Paso {name}: {type(exc).__name__}: {exc}")


def run_dgcp(
    mode: str = "incremental",
    since: date | None = None,
    trigger: str = "cron",
    steps: set[str] | None = None,
    process_items: bool = True,
) -> int:
    """incremental: últimos 15 días (4×/día). backfill/sweep: toda la ventana desde SYNC_SINCE."""
    settings = get_settings()
    since = since or settings.sync_since
    now = datetime.now(UTC)
    incremental = mode == "incremental"
    cutoff = (
        now - timedelta(days=15) if incremental else datetime.combine(since, datetime.min.time(), UTC) - timedelta(days=30)
    )
    proc_start = (now - timedelta(days=15)).date() if incremental else since

    def want(step: str) -> bool:
        return steps is None or step in steps

    with advisory_lock(f"dgcp:{mode}") as locked, session_scope() as session:
        if not locked:
            log.warning("job_already_running", job=f"dgcp:{mode}")
            return 0
        with (
            sync_run(session, "dgcp", f"dgcp_{mode}", {"since": since.isoformat(), "mode": mode}, trigger) as ctx,
            PoliteClient(settings) as client,
        ):
            sync = DgcpSync(session, client, ctx, settings)
            if not incremental:
                sync.fetch_missing_contracts_per_page = 0
            if want("units"):
                _step(ctx, "unidades", sync.sync_units)
            if not incremental and want("catalog"):
                _step(ctx, "catalogo", sync.sync_catalog)
            # El directorio completo de proveedores (≈130 mil) falla de forma intermitente (HTTP 500) y la
            # mayoría no tiene contratos en la ventana: solo se pide de forma explícita (--steps suppliers_full).
            if steps is not None and "suppliers_full" in steps:
                _step(ctx, "proveedores", sync.sync_suppliers_full)
            if want("processes"):
                _step(ctx, "procesos", lambda: sync.sync_processes(proc_start, now.date()))
            if want("contracts"):
                _step(
                    ctx,
                    "contratos",
                    lambda: sync.walk(
                        PageWalk("contratos", "fecha_creacion_contrato", cutoff, incremental),
                        sync.handle_contracts,
                        "contratos",
                    ),
                )
            if want("contract_items"):
                _step(
                    ctx,
                    "articulos_contratados",
                    lambda: sync.walk(
                        PageWalk(
                            "contratos/articulos",
                            "fecha_creacion_contrato",
                            cutoff,
                            incremental,
                            workers=1 if incremental else 3,
                        ),
                        sync.handle_contract_items,
                        "contratos_articulos",
                    ),
                )
            if want("bids"):
                _step(
                    ctx,
                    "ofertas",
                    lambda: sync.walk(
                        PageWalk("ofertas", "fecha_creacion", cutoff, incremental, workers=1 if incremental else 3),
                        sync.handle_bids,
                        "ofertas",
                    ),
                )
            if process_items and want("process_items"):
                # Artículos solicitados (precios estimados): solo procesos recientes, por proceso,
                # para no llenar la base gratuita con millones de líneas históricas.
                _step(
                    ctx,
                    "articulos_procesos",
                    lambda: refresh_recent_process_items(session, sync, 120 if incremental else 400),
                )
            if want("missing_processes") or steps is None:
                _step(ctx, "procesos_faltantes", lambda: sync.fetch_missing_processes(300 if incremental else 600))
            if want("suppliers") or (incremental and steps is None):
                _step(ctx, "enriquecer_proveedores", lambda: sync.enrich_suppliers(300 if incremental else 1000))
            _step(ctx, "vinculos", lambda: link_orphans(session))
            if mode == "sweep" and settings.retention_months:
                from tirds.maintenance import prune

                _step(ctx, "ventana_movil", lambda: prune(session, settings.retention_months or 0))
            _step(ctx, "indice_busqueda", lambda: refresh_search_index(session, (now - timedelta(hours=1)).isoformat()))
            session.commit()
            return ctx.run.id


def refresh_recent_process_items(session: Any, sync: DgcpSync, limit: int) -> int:
    from sqlalchemy import select

    from tirds.db.models import ProcurementProcess

    procs = (
        session.execute(
            select(ProcurementProcess)
            .where(ProcurementProcess.items_loaded_at.is_(None))
            .order_by(ProcurementProcess.published_at.desc().nulls_last())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    for proc in procs:
        sync.refresh_process_detail(proc, documents=False)
        session.commit()
    return len(procs)


def link_orphans(session: Any) -> None:
    """Completa vínculos que llegaron desordenados (contrato antes que su proceso, etc.)."""
    session.execute(
        text(
            "UPDATE contracts c SET process_id = p.id FROM procurement_processes p "
            "WHERE c.process_id IS NULL AND c.process_code = p.code"
        )
    )
    session.execute(
        text(
            "UPDATE bids b SET process_id = p.id FROM procurement_processes p "
            "WHERE b.process_id IS NULL AND b.process_code = p.code"
        )
    )
    session.execute(
        text(
            "UPDATE contracts c SET supplier_id = s.id FROM suppliers s "
            "WHERE c.supplier_id IS NULL AND c.supplier_rpe = s.rpe"
        )
    )
    session.execute(
        text("UPDATE bids b SET supplier_id = s.id FROM suppliers s WHERE b.supplier_id IS NULL AND b.supplier_rpe = s.rpe")
    )


def run_search_refresh(full: bool = False) -> dict[str, int]:
    with session_scope() as session:
        return refresh_search_index(session, "-infinity" if full else (datetime.now(UTC) - timedelta(days=1)).isoformat())
