"""CLI del pipeline: `tirds --help`."""

from __future__ import annotations

import json
import logging
import sys
from datetime import date
from pathlib import Path
from typing import Annotated

import structlog
import typer

from tirds.config import get_settings

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.JSONRenderer(ensure_ascii=False),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)

app = typer.Typer(help="Tus Impuestos RD — pipeline de datos y motor de análisis", no_args_is_help=True)
db_app = typer.Typer(help="Base de datos")
sync_app = typer.Typer(help="Sincronización de fuentes oficiales")
admin_app = typer.Typer(help="Usuarios del panel de administración")
app.add_typer(db_app, name="db")
app.add_typer(sync_app, name="sync")
app.add_typer(admin_app, name="admin")

PIPELINE_DIR = Path(__file__).resolve().parents[2]


@db_app.command("upgrade")
def db_upgrade() -> None:
    """Aplica migraciones y datos de referencia (fuentes, reglas, umbrales)."""
    from alembic.config import Config

    from alembic import command
    from tirds.db.session import session_scope
    from tirds.seed import seed_reference

    cfg = Config(str(PIPELINE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(PIPELINE_DIR / "alembic"))
    command.upgrade(cfg, "head")
    with session_scope() as session:
        seed_reference(session)
    typer.echo("Migraciones y datos de referencia aplicados.")


@db_app.command("size")
def db_size() -> None:
    """Tamaño de la base y de las tablas más grandes."""
    from sqlalchemy import text

    from tirds.db.session import session_scope

    with session_scope() as s:
        total = s.execute(text("SELECT pg_size_pretty(pg_database_size(current_database()))")).scalar()
        typer.echo(f"Total: {total}")
        for name, size, rows in s.execute(
            text(
                "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)), n_live_tup "
                "FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15"
            )
        ):
            typer.echo(f"  {name:<28} {size:>10}  {rows} filas")


@sync_app.command("dgcp")
def sync_dgcp(
    mode: Annotated[str, typer.Option(help="incremental | backfill | sweep")] = "incremental",
    since: Annotated[str | None, typer.Option(help="YYYY-MM-DD (por defecto SYNC_SINCE)")] = None,
    steps: Annotated[str | None, typer.Option(help="Pasos separados por coma")] = None,
    no_process_items: Annotated[bool, typer.Option("--no-process-items")] = False,
    trigger: Annotated[str, typer.Option()] = "manual",
) -> None:
    from tirds.jobs import run_dgcp

    if mode not in {"incremental", "backfill", "sweep"}:
        raise typer.BadParameter("modo inválido")
    run_id = run_dgcp(
        mode,
        date.fromisoformat(since) if since else None,
        trigger=trigger,
        steps=set(steps.split(",")) if steps else None,
        process_items=not no_process_items,
    )
    typer.echo(f"Sincronización DGCP terminada (sync_run {run_id}).")


@sync_app.command("mapainversiones")
def sync_mapainversiones(trigger: str = "manual") -> None:
    from tirds.sources.mapainversiones import run_mapainversiones

    run_mapainversiones(trigger=trigger)


@sync_app.command("hacienda")
def sync_hacienda(trigger: str = "manual") -> None:
    from tirds.sources.ckan_hacienda import run_hacienda

    run_hacienda(trigger=trigger)


@sync_app.command("bcrd")
def sync_bcrd(trigger: str = "manual") -> None:
    from tirds.sources.bcrd import run_bcrd

    run_bcrd(trigger=trigger)


@sync_app.command("transparencia-fiscal")
def sync_transparencia(trigger: str = "manual") -> None:
    from tirds.sources.transparencia_fiscal import check_transparencia_fiscal

    typer.echo(check_transparencia_fiscal(trigger=trigger))


@app.command("analyze")
def analyze(
    details: Annotated[int, typer.Option(help="Máx. procesos a enriquecer con documentos/OCDS")] = 150,
) -> None:
    """Ejecuta el Motor de Análisis de Contrataciones y publica alertas que cumplan los criterios."""
    from tirds.analytics.engine import run_analysis

    result = run_analysis(detail_budget=details)
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2, default=str))


@app.command("search-refresh")
def search_refresh(full: bool = True) -> None:
    from tirds.jobs import run_search_refresh

    typer.echo(run_search_refresh(full=full))


@db_app.command("rehash")
def db_rehash(tables: str = "institutions,suppliers,procurement_processes,contracts,bids,investment_projects") -> None:
    """Recalcula hashes de contenido tras un cambio de reglas de mapeo (no genera versiones)."""
    from sqlalchemy import text

    from tirds.db.session import session_scope
    from tirds.maintenance import rehash

    with session_scope() as s:
        s.execute(text("UPDATE procurement_processes SET description = NULL WHERE description = title"))
        s.execute(text("UPDATE bids SET name = NULL WHERE name IS NOT NULL"))
        s.commit()
        for t in tables.split(","):
            typer.echo(f"{t}: {rehash(s, t)} filas")


@db_app.command("prune")
def db_prune(keep_months: Annotated[int, typer.Option(help="Meses de compras a conservar")] = 14) -> None:
    """Ventana móvil: borra compras antiguas que no sustentan alertas (ver docs/mantenimiento.md)."""
    from tirds.db.session import session_scope
    from tirds.maintenance import prune

    with session_scope() as s:
        typer.echo(prune(s, keep_months))


@app.command("status")
def status() -> None:
    """Estado de las fuentes y últimas ejecuciones."""
    from sqlalchemy import text

    from tirds.db.session import session_scope

    with session_scope() as s:
        for row in s.execute(
            text("SELECT code, status, last_success_at, consecutive_failures FROM data_sources ORDER BY code")
        ):
            typer.echo(
                f"{row.code:<22} {row.status:<12} último éxito: {row.last_success_at}  fallos seguidos: {row.consecutive_failures}"
            )
        typer.echo("")
        for row in s.execute(
            text(
                "SELECT id, job, status, started_at, duration_ms, records_fetched, records_new, records_changed, errors "
                "FROM sync_runs ORDER BY id DESC LIMIT 10"
            )
        ):
            typer.echo(
                f"#{row.id} {row.job:<20} {row.status:<8} {row.started_at:%Y-%m-%d %H:%M} "
                f"{(row.duration_ms or 0) / 1000:.0f}s  obtenidos={row.records_fetched} nuevos={row.records_new} "
                f"cambiados={row.records_changed} errores={row.errors}"
            )


@admin_app.command("create")
def admin_create(
    email: str,
    name: Annotated[str, typer.Option()] = "Administración",
    role: Annotated[str, typer.Option(help="admin | editor | lector")] = "admin",
) -> None:
    """Crea o actualiza un usuario del panel. La contraseña se pide por consola."""
    from argon2 import PasswordHasher
    from sqlalchemy.dialects.postgresql import insert

    from tirds.db.models import AdminUser, AuditLog
    from tirds.db.session import session_scope

    if role not in {"admin", "editor", "lector"}:
        raise typer.BadParameter("rol inválido")
    password = typer.prompt("Contraseña (mín. 12 caracteres)", hide_input=True, confirmation_prompt=True)
    if len(password) < 12:
        typer.echo("La contraseña debe tener al menos 12 caracteres.", err=True)
        raise typer.Exit(1)
    hashed = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1).hash(password)
    with session_scope() as s:
        stmt = insert(AdminUser).values(email=email.lower(), display_name=name, password_hash=hashed, role=role)
        stmt = stmt.on_conflict_do_update(
            index_elements=["email"], set_={"password_hash": hashed, "role": role, "display_name": name, "active": True}
        )
        s.execute(stmt)
        s.add(
            AuditLog(
                actor="cli",
                action="admin_user_upsert",
                entity="admin_users",
                entity_id=email.lower(),
                details={"role": role},
            )
        )
    typer.echo(f"Usuario {email} listo con rol {role}.")


@app.command("seed-demo")
def seed_demo() -> None:
    """Carga datos FICTICIOS para desarrollo. Se niega a correr en producción."""
    settings = get_settings()
    if settings.is_production:
        typer.echo("Rechazado: APP_ENV=production. Los datos ficticios nunca van a producción.", err=True)
        raise typer.Exit(2)
    from tirds.demo import load_demo

    typer.echo(load_demo())


@app.command("run-scheduled")
def run_scheduled() -> None:
    """Para contenedores self-hosted: ejecuta el ciclo completo una vez (cron externo)."""
    from tirds.analytics.engine import run_analysis
    from tirds.jobs import run_dgcp

    run_dgcp("incremental", trigger="cron")
    run_analysis()


def main() -> None:
    try:
        app()
    except KeyboardInterrupt:
        sys.exit(130)
