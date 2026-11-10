"""Ciclo de vida de una sincronización: registro, contadores, estado de la fuente y alertas."""

from __future__ import annotations

import time
import traceback
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from tirds.config import get_settings
from tirds.db.models import DataSource, SyncRun
from tirds.transform.upsert import Counts

log = structlog.get_logger()


class RunContext:
    def __init__(self, session: Session, run: SyncRun):
        self.session = session
        self.run = run
        self.counts = Counts()
        self.errors: list[str] = []
        self.requests = 0

    def record(self, counts: Counts) -> None:
        self.counts.add(counts)

    def error(self, message: str) -> None:
        log.error("sync_error", message=message)
        self.errors.append(message[:2000])

    def checkpoint(self, cursor: dict[str, Any]) -> None:
        self.run.cursor = cursor
        self._flush_counts()
        self.session.commit()

    def _flush_counts(self) -> None:
        c = self.counts
        self.run.records_fetched = c.fetched
        self.run.records_new = c.new
        self.run.records_changed = c.changed
        self.run.records_unchanged = c.unchanged
        self.run.records_invalid = c.invalid
        self.run.errors = len(self.errors)
        self.run.requests_made = self.requests


@contextmanager
def sync_run(
    session: Session, source_code: str, job: str, params: dict[str, Any] | None = None, trigger: str = "cron"
) -> Iterator[RunContext]:
    run = SyncRun(source_code=source_code, job=job, params=params or {}, trigger=trigger, status="running")
    session.add(run)
    session.commit()
    ctx = RunContext(session, run)
    started = time.monotonic()
    source = session.execute(select(DataSource).where(DataSource.code == source_code)).scalar_one_or_none()
    now = datetime.now(UTC)
    try:
        yield ctx
    except Exception as exc:
        session.rollback()
        ctx.error(f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=5)}")
        run.status = "failed"
        _finish(session, ctx, started, source, now, failed=True)
        raise
    else:
        run.status = "partial" if ctx.errors else "success"
        _finish(session, ctx, started, source, now, failed=False)


def _finish(
    session: Session, ctx: RunContext, started: float, source: DataSource | None, now: datetime, failed: bool
) -> None:
    run = ctx.run
    ctx._flush_counts()
    run.finished_at = datetime.now(UTC)
    run.duration_ms = int((time.monotonic() - started) * 1000)
    run.error_detail = "\n---\n".join(ctx.errors)[:10000] if ctx.errors else None
    if ctx.counts.unknown_fields:
        run.params = {**(run.params or {}), "campos_nuevos_en_origen": dict(ctx.counts.unknown_fields)}
    session.merge(run)
    if source is not None:
        source = session.merge(source)
        source.last_attempt_at = now
        if failed:
            source.consecutive_failures += 1
            source.last_error = (run.error_detail or "")[:2000]
            if source.consecutive_failures >= 2 and source.status == "activa":
                source.status = "degradada"
        else:
            source.consecutive_failures = 0
            source.last_success_at = run.finished_at
            if source.status == "degradada":
                source.status = "activa"
    session.commit()
    log.info(
        "sync_finished",
        source=run.source_code,
        job=run.job,
        status=run.status,
        fetched=run.records_fetched,
        new=run.records_new,
        changed=run.records_changed,
        seconds=round((run.duration_ms or 0) / 1000, 1),
    )
    if failed and source is not None:
        maybe_open_issue(source)


def maybe_open_issue(source: DataSource) -> None:
    """Alerta operativa: abre un issue en GitHub tras N fallos seguidos (si hay token)."""
    s = get_settings()
    if not (s.github_token and s.github_repository) or source.consecutive_failures != s.failure_issue_threshold:
        return
    try:
        httpx.post(
            f"https://api.github.com/repos/{s.github_repository}/issues",
            headers={"Authorization": f"Bearer {s.github_token}", "Accept": "application/vnd.github+json"},
            json={
                "title": f"Sincronización fallando: {source.name}",
                "body": (
                    f"La fuente `{source.code}` falló {source.consecutive_failures} veces seguidas.\n\n"
                    f"Último error:\n```\n{(source.last_error or '')[:1500]}\n```"
                ),
                "labels": ["operaciones"],
            },
            timeout=30,
        ).raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("issue_failed", error=str(exc))
