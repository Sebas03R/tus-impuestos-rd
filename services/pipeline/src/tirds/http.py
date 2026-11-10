"""Cliente HTTP cortés con las fuentes oficiales.

- Token bucket (por defecto 50 solicitudes/min; la DGCP permite 60).
- Respeta cabeceras x-ratelimit-remaining / x-ratelimit-reset.
- Reintentos con backoff exponencial + jitter ante 429, 5xx y errores de red.
- Lista blanca de hosts (protección SSRF) y límite de tamaño de descarga.
"""

from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse

import httpx
import structlog

from tirds.config import ALLOWED_HOSTS, Settings, get_settings

log = structlog.get_logger()

RETRY_STATUS = {429, 500, 502, 503, 504}


class SourceUnavailable(Exception):
    """La fuente no respondió correctamente tras los reintentos."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class DisallowedHost(Exception):
    pass


@dataclass
class TokenBucket:
    rate_per_minute: int
    _tokens: float = field(init=False)
    _last: float = field(init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False)
    sleep: Any = time.sleep
    clock: Any = time.monotonic

    def __post_init__(self) -> None:
        self._tokens = float(self.rate_per_minute)
        self._last = self.clock()

    def acquire(self) -> None:
        with self._lock:
            while True:
                now = self.clock()
                self._tokens = min(
                    float(self.rate_per_minute),
                    self._tokens + (now - self._last) * self.rate_per_minute / 60.0,
                )
                self._last = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                self.sleep((1 - self._tokens) * 60.0 / self.rate_per_minute)


def check_host(url: str) -> None:
    host = (urlparse(url).hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise DisallowedHost(f"Host no permitido: {host!r}")


class PoliteClient:
    def __init__(
        self,
        settings: Settings | None = None,
        transport: httpx.BaseTransport | None = None,
        max_retries: int = 5,
        base_backoff_s: float = 2.0,
        sleep: Any = time.sleep,
    ) -> None:
        self.settings = settings or get_settings()
        self.bucket = TokenBucket(self.settings.requests_per_minute, sleep=sleep)
        self.max_retries = max_retries
        self.base_backoff_s = base_backoff_s
        self.sleep = sleep
        self.requests_made = 0
        self._client = httpx.Client(
            timeout=httpx.Timeout(self.settings.http_timeout_s, connect=20.0),
            headers={"User-Agent": self.settings.user_agent, "Accept": "application/json, */*"},
            follow_redirects=False,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _respect_headers(self, response: httpx.Response) -> None:
        remaining = response.headers.get("x-ratelimit-remaining")
        reset = response.headers.get("x-ratelimit-reset")
        if remaining is not None and reset is not None:
            try:
                if int(remaining) <= 2:
                    wait = min(float(reset), 60.0) + 1
                    log.info("rate_limit_pause", seconds=wait)
                    self.sleep(wait)
            except ValueError:
                pass

    def request(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        check_host(url)
        attempt = 0
        while True:
            attempt += 1
            self.bucket.acquire()
            self.requests_made += 1
            try:
                response = self._client.get(url, params=params, headers=headers)
            except httpx.TransportError as exc:
                if attempt > self.max_retries:
                    raise SourceUnavailable(f"Error de red: {exc}") from exc
                self._backoff(attempt, None)
                continue

            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location", "")
                target = str(response.url.join(location))
                check_host(target)  # nunca seguir redirecciones fuera de la lista blanca
                url, params = target, None
                continue

            if response.status_code in RETRY_STATUS:
                if attempt > self.max_retries:
                    raise SourceUnavailable(
                        f"HTTP {response.status_code} tras {attempt} intentos: {url}",
                        status=response.status_code,
                    )
                retry_after = response.headers.get("retry-after")
                self._backoff(attempt, float(retry_after) if retry_after and retry_after.isdigit() else None)
                continue

            if response.status_code >= 400:
                raise SourceUnavailable(f"HTTP {response.status_code}: {url}", status=response.status_code)

            length = int(response.headers.get("content-length") or 0)
            if length > self.settings.max_download_bytes or len(response.content) > self.settings.max_download_bytes:
                raise SourceUnavailable(f"Descarga excede el límite permitido: {url}")

            self._respect_headers(response)
            return response

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        response = self.request(url, params=params)
        try:
            # parse_float=Decimal: los montos nunca pasan por float.
            return response.json(parse_float=Decimal)
        except ValueError as exc:
            raise SourceUnavailable(f"Respuesta no es JSON válido: {url}") from exc

    def _backoff(self, attempt: int, retry_after: float | None) -> None:
        delay = retry_after if retry_after is not None else self.base_backoff_s * (2 ** (attempt - 1))
        delay = min(delay, 120.0) * (0.75 + random.random() * 0.5)
        log.warning("retry_backoff", attempt=attempt, seconds=round(delay, 1))
        self.sleep(delay)
