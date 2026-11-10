"""Conexión a PostgreSQL."""

from __future__ import annotations

import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from tirds.config import get_settings


def _normalize_url(url: str) -> str:
    # Supabase entrega postgres:// o postgresql:// ; SQLAlchemy necesita el driver psycopg3.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


@lru_cache
def get_engine(url: str | None = None) -> Engine:
    settings = get_settings()
    return create_engine(
        _normalize_url(url or settings.database_url),
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        # El pooler transaccional de Supabase no admite prepared statements persistentes.
        connect_args={
            "prepare_threshold": None,
            "application_name": "tirds-pipeline",
            "options": "-c timezone=UTC",
        },
    )


@lru_cache
def _factory(url: str | None = None) -> sessionmaker[Session]:
    return sessionmaker(get_engine(url), expire_on_commit=False)


@contextmanager
def session_scope(url: str | None = None) -> Iterator[Session]:
    session = _factory(url)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


ADVISORY_LOCK_NS = 0x7149_5244  # "TIRD"


@contextmanager
def advisory_lock(name: str) -> Iterator[bool]:
    """Evita ejecuciones solapadas del mismo job. Usa una conexión dedicada porque la
    sesión ORM devuelve su conexión al pool en cada commit (el lock es por conexión)."""
    key = zlib.crc32(name.encode()) % (2**31)  # estable entre procesos
    with get_engine().connect() as conn:
        got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:a, :b)"), {"a": ADVISORY_LOCK_NS, "b": key}).scalar())
        conn.commit()
        try:
            yield got
        finally:
            if got:
                conn.execute(text("SELECT pg_advisory_unlock(:a, :b)"), {"a": ADVISORY_LOCK_NS, "b": key})
                conn.commit()
