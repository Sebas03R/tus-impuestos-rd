"""Conversión segura de valores de origen. Desconocido => None (nunca 0)."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

_FRACTION = re.compile(r"\.(\d+)")
_SPACES = re.compile(r"\s+")
_NULLS = {"", "n/a", "na", "null", "none", "-", "no aplica"}


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = _SPACES.sub(" ", str(value).replace("\t", " ")).strip()
    return None if text.lower() in _NULLS else text


def to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(repr(value))
    text = str(value).strip().replace(",", "")
    if text.lower() in _NULLS:
        return None
    try:
        result = Decimal(text)
    except InvalidOperation:
        return None
    return result if result.is_finite() else None


# Las columnas de montos son NUMERIC(18,2) (máx. < 10^16) y las de cantidades NUMERIC(18,4)
# (máx. < 10^14). La DGCP publica a veces valores basura (p. ej. 1e20 en una oferta) que harían
# fallar el lote completo; ningún monto o cantidad real se acerca a 10^14.
PLAUSIBLE_MAX = Decimal(10) ** 14


def to_amount(value: Any) -> Decimal | None:
    """Como to_decimal, pero descarta (None) valores imposibles de almacenar o de creer."""
    dec = to_decimal(value)
    if dec is None or abs(dec) >= PLAUSIBLE_MAX:
        return None
    return dec


def to_int(value: Any) -> int | None:
    dec = to_decimal(value)
    if dec is None or dec != dec.to_integral_value():
        return None
    return int(dec)


def to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    text = (clean_text(value) or "").lower()
    if text in {"si", "sí", "true", "1", "yes"}:
        return True
    if text in {"no", "false", "0"}:
        return False
    return None


def to_datetime(value: Any) -> datetime | None:
    """Acepta ISO 8601 con 0–7 decimales (la DGCP envía 7) y sufijo Z."""
    text = clean_text(value)
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    text = _FRACTION.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), text, count=1)
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        # Fechas sin zona en fuentes dominicanas se interpretan en America/Santo_Domingo (UTC-4).
        from zoneinfo import ZoneInfo

        parsed = parsed.replace(tzinfo=ZoneInfo("America/Santo_Domingo"))
    if parsed.year < 1990 or parsed.year > 2100:
        return None
    return parsed.astimezone(UTC)


def to_date(value: Any) -> date | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        dt = to_datetime(text)
        return dt.date() if dt else None


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def slugify(text: str, max_len: int = 80) -> str:
    base = strip_accents(text).lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return base[:max_len].strip("-") or "sin-nombre"


def _default(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        # Forma canónica: "470000", "50.86" (igual venga de la API o de NUMERIC(18,4) en la BD).
        return format(obj.normalize(), "f")
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(type(obj))


def stable_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, ensure_ascii=False, default=_default, separators=(",", ":"))


def content_hash(data: dict[str, Any]) -> str:
    """128 bits bastan para detectar cambios y ahorran espacio frente a 256."""
    return hashlib.sha256(stable_json(data).encode()).hexdigest()[:32]


def line_hash(data: dict[str, Any]) -> str:
    return hashlib.md5(stable_json(data).encode(), usedforsecurity=False).hexdigest()


def currency_code(value: Any) -> str | None:
    text = (clean_text(value) or "").upper()
    if not text:
        return None
    aliases = {"RD$": "DOP", "PESO DOMINICANO": "DOP", "US$": "USD", "DOLAR": "USD", "EURO": "EUR"}
    text = aliases.get(text, text)
    return text if re.fullmatch(r"[A-Z]{3}", text) else None
