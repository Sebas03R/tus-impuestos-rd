"""Portal de Transparencia Fiscal: verificación de acceso (sin eludir controles).

El portal consume `api-sigef.hacienda.gob.do/servicios/datosabiertos/portaltransparencia/`,
que responde 401 sin el token que el propio sitio obtiene con reCAPTCHA. No se intenta
obtener ese token. Este adaptador solo comprueba si el acceso cambió y actualiza el estado.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
from sqlalchemy import select

from tirds.config import get_settings
from tirds.db.models import DataSource
from tirds.db.session import session_scope

ENDPOINT = "https://api-sigef.hacienda.gob.do/servicios/datosabiertos/portaltransparencia/"


def check_transparencia_fiscal(trigger: str = "cron") -> str:
    try:
        r = httpx.get(ENDPOINT, timeout=30, headers={"User-Agent": get_settings().user_agent})
        status = r.status_code
    except httpx.HTTPError as exc:
        status = None
        detail = f"Sin respuesta: {exc}"
    with session_scope() as s:
        src = s.execute(select(DataSource).where(DataSource.code == "transparencia_fiscal")).scalar_one()
        src.last_attempt_at = datetime.now(UTC)
        if status in (401, 403):
            src.status = "bloqueada"
            detail = (
                f"HTTP {status}: requiere el token que genera el portal con reCAPTCHA. "
                "Pendiente de acceso autorizado; no se usa."
            )
        elif status == 200:
            src.status = "degradada"
            detail = "HTTP 200: el acceso parece abierto. Requiere revisión manual antes de integrar."
        elif status is not None:
            detail = f"HTTP {status}"
        src.status_detail = detail
        return detail
