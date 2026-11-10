"""Infraestructura de pruebas: base de datos `tirds_test` aislada en el Postgres local."""

from __future__ import annotations

import os
from collections.abc import Iterator

import psycopg
import pytest

ADMIN_URL = os.environ.get("TEST_ADMIN_URL", "postgresql://tirds:tirds_local_only@localhost:54330/postgres")
TEST_DB = os.environ.get("TEST_DB_NAME", "tirds_test")
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + f"/{TEST_DB}"
os.environ["DATABASE_URL"] = TEST_URL.replace("postgresql://", "postgresql+psycopg://")
os.environ["APP_ENV"] = "test"
os.environ["SNAPSHOT_DIR"] = "/tmp/tirds-test-snapshots"
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("GITHUB_TOKEN", None)

TABLES_TO_KEEP = {"alembic_version", "data_sources", "detection_rules", "legal_thresholds"}


def _db_available() -> bool:
    try:
        with psycopg.connect(ADMIN_URL, connect_timeout=3):
            return True
    except psycopg.OperationalError:
        return False


@pytest.fixture(scope="session")
def database() -> Iterator[str]:
    if not _db_available():
        pytest.skip("Postgres local no disponible (docker compose up -d db)")
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    from tirds.config import get_settings

    get_settings.cache_clear()
    from alembic.config import Config

    from alembic import command
    from tirds.cli import PIPELINE_DIR
    from tirds.db.session import session_scope
    from tirds.seed import seed_reference

    cfg = Config(str(PIPELINE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(PIPELINE_DIR / "alembic"))
    command.upgrade(cfg, "head")
    with session_scope() as s:
        seed_reference(s)
    yield TEST_URL


@pytest.fixture
def db(database: str) -> Iterator[object]:
    from sqlalchemy import text

    from tirds.db.session import session_scope

    with session_scope() as s:
        tables = [r[0] for r in s.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))]
        wipe = [t for t in tables if t not in TABLES_TO_KEEP]
        s.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in wipe) + " RESTART IDENTITY CASCADE"))
        s.execute(text("UPDATE data_sources SET consecutive_failures = 0, last_attempt_at = NULL, last_success_at = NULL"))
    with session_scope() as s:
        yield s
