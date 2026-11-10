"""Copias comprimidas (.ndjson.gz) de lo descargado, para auditoría y reproducibilidad.

Se suben a Supabase Storage (bucket privado) si hay credenciales; si no, quedan en disco.
Así los 500 MB de la base de datos se reservan para datos procesados.
"""

from __future__ import annotations

import gzip
import hashlib
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import structlog
from sqlalchemy.orm import Session

from tirds.config import Settings, get_settings
from tirds.db.models import SourceSnapshot
from tirds.transform.parse import stable_json

log = structlog.get_logger()
ROTATE_BYTES = 40 * 1024 * 1024  # límite por archivo del plan gratuito de Storage: 50 MB


class SnapshotWriter:
    def __init__(self, session: Session, sync_run_id: int, source: str, entity: str, settings: Settings | None = None):
        self.session = session
        self.sync_run_id = sync_run_id
        self.source = source
        self.entity = entity
        self.settings = settings or get_settings()
        self._part = 0
        self._open()

    def _open(self) -> None:
        self._part += 1
        fd, name = tempfile.mkstemp(suffix=".ndjson.gz")
        os.close(fd)
        self._tmp = Path(name)
        self._fh = gzip.open(self._tmp, "wt", encoding="utf-8")  # noqa: SIM115 - se cierra en _finish_part
        self._count = 0

    def write(self, records: list[dict[str, Any]]) -> None:
        for rec in records:
            self._fh.write(stable_json(rec))
            self._fh.write("\n")
            self._count += 1
        self._fh.flush()
        if self._tmp.stat().st_size >= ROTATE_BYTES:
            self._finish_part()
            self._open()

    def _finish_part(self) -> None:
        self._fh.close()
        if self._count == 0:
            self._tmp.unlink(missing_ok=True)
            return
        data = self._tmp.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        stamp = datetime.now(UTC).strftime("%Y/%m/%d")
        path = f"{self.source}/{stamp}/run-{self.sync_run_id}-{self.entity}-{self._part}.ndjson.gz"
        stored = self._store(path, data)
        self.session.add(
            SourceSnapshot(
                sync_run_id=self.sync_run_id,
                entity=self.entity,
                storage_path=stored,
                record_count=self._count,
                bytes=len(data),
                sha256=digest,
            )
        )
        self._tmp.unlink(missing_ok=True)

    def _store(self, path: str, data: bytes) -> str:
        s = self.settings
        if s.supabase_url and s.supabase_service_key:
            url = f"{s.supabase_url.rstrip('/')}/storage/v1/object/{s.snapshot_bucket}/{path}"
            try:
                r = httpx.post(
                    url,
                    content=data,
                    headers={
                        "Authorization": f"Bearer {s.supabase_service_key}",
                        "apikey": s.supabase_service_key,
                        "Content-Type": "application/gzip",
                        "x-upsert": "true",
                    },
                    timeout=120,
                )
                r.raise_for_status()
                return f"storage://{s.snapshot_bucket}/{path}"
            except httpx.HTTPError as exc:  # el snapshot no debe tumbar la sincronización
                log.warning("snapshot_upload_failed", error=str(exc), path=path)
        target = s.snapshot_dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(data)
        return f"file://{target}"

    def close(self) -> None:
        self._finish_part()

    def __enter__(self) -> SnapshotWriter:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
