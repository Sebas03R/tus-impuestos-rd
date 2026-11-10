"""Umbrales oficiales de modalidades de compra, versionados por vigencia.

Solo se cargan cifras con fuente oficial citada. Una regla que dependa de umbrales
(fraccionamiento) no publica alertas para fechas sin umbral verificado.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from tirds.db.models import LegalThreshold

PNP_01_2025 = {
    "source_name": "Resolución DGCP PNP-01-2025 (2 de enero de 2025), umbrales 2025",
    "source_url": "https://dgcp.gob.do/wp-content/uploads/page/PNP-01-2025%20Umbrales.pdf",
}
PNP_03_2026 = {
    "source_name": "Resolución DGCP PNP-03-2026 (25 de marzo de 2026), umbrales bajo Ley 47-25",
    "source_url": "https://www.dgcp.gob.do/wp-content/uploads/page/PNP-03-2026_UMBRALES.pdf",
}
_P1 = {"valid_from": date(2025, 1, 2), "valid_to": date(2026, 3, 31), "verified": True, **PNP_01_2025}
_P3 = {"valid_from": date(2026, 4, 1), "valid_to": None, "verified": True, **PNP_03_2026}
_D = Decimal

# Montos tal como aparecen en las resoluciones (bienes y servicios comparten cifras).
# Entre el 29-ene-2026 y el 31-mar-2026 los montos de PNP-01-2025 siguieron vigentes bajo la Ley 47-25
# (Resolución PNP-01-2026, art. 2). El régimen se decide por la fecha de convocatoria del proceso.
THRESHOLDS: list[dict[str, Any]] = [
    # --- 2025 (PNP-01-2025) ---
    {
        "regime": "ley_340_06",
        "modality": "debajo_umbral",
        "object_type": "bienes_servicios",
        "min_amount": None,
        "max_amount": _D("248085.66"),
        **_P1,
        "notes": "La resolución no tiene fila propia; se infiere como inferior al mínimo de Compras Menores.",
    },
    {
        "regime": "ley_340_06",
        "modality": "compra_menor",
        "object_type": "bienes_servicios",
        "min_amount": _D("248085.67"),
        "max_amount": _D("1860642.55"),
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "comparacion_precios",
        "object_type": "bienes_servicios",
        "min_amount": _D("1860642.56"),
        "max_amount": _D("5644812.73"),
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "licitacion_restringida",
        "object_type": "bienes_servicios",
        "min_amount": _D("5644812.74"),
        "max_amount": _D("6272014.15"),
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "licitacion_publica",
        "object_type": "bienes_servicios",
        "min_amount": _D("6272014.16"),
        "max_amount": None,
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "comparacion_precios",
        "object_type": "obras",
        "min_amount": _D("49617134.88"),
        "max_amount": _D("186064255.80"),
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "sorteo_obras",
        "object_type": "obras",
        "min_amount": _D("186064255.81"),
        "max_amount": _D("310107093.00"),
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "licitacion_restringida",
        "object_type": "obras",
        "min_amount": _D("310107093.01"),
        "max_amount": _D("411347975.99"),
        **_P1,
    },
    {
        "regime": "ley_340_06",
        "modality": "licitacion_publica",
        "object_type": "obras",
        "min_amount": _D("411347976.00"),
        "max_amount": None,
        **_P1,
    },
    # --- desde 1-abr-2026 (PNP-03-2026, Ley 47-25 art. 59) ---
    {
        "regime": "ley_47_25",
        "modality": "debajo_umbral",
        "object_type": "bienes_servicios",
        "min_amount": _D("0.01"),
        "max_amount": _D("268111.37"),
        **_P3,
        "notes": "Contratación directa sujeta al umbral.",
    },
    {
        "regime": "ley_47_25",
        "modality": "compra_menor",
        "object_type": "bienes_servicios",
        "min_amount": _D("268111.38"),
        "max_amount": _D("2010835.37"),
        **_P3,
        "notes": "Contratación menor.",
    },
    {
        "regime": "ley_47_25",
        "modality": "comparacion_precios",
        "object_type": "bienes_servicios",
        "min_amount": _D("2010835.38"),
        "max_amount": _D("6436757.50"),
        **_P3,
        "notes": "Contratación simplificada.",
    },
    {
        "regime": "ley_47_25",
        "modality": "licitacion_publica",
        "object_type": "bienes_servicios",
        "min_amount": _D("6436757.51"),
        "max_amount": None,
        **_P3,
    },
    {
        "regime": "ley_47_25",
        "modality": "compra_menor",
        "object_type": "obras",
        "min_amount": _D("0.01"),
        "max_amount": _D("53622276.92"),
        **_P3,
        "notes": "Contratación menor de obras.",
    },
    {
        "regime": "ley_47_25",
        "modality": "comparacion_precios",
        "object_type": "obras",
        "min_amount": _D("53622276.93"),
        "max_amount": _D("201083538.47"),
        **_P3,
        "notes": "Contratación simplificada.",
    },
    {
        "regime": "ley_47_25",
        "modality": "sorteo_obras",
        "object_type": "obras",
        "min_amount": _D("201083538.48"),
        "max_amount": _D("406713345.69"),
        **_P3,
    },
    {
        "regime": "ley_47_25",
        "modality": "licitacion_publica",
        "object_type": "obras",
        "min_amount": _D("406713345.70"),
        "max_amount": None,
        **_P3,
    },
]
# El tramo 29-ene-2026 a 31-mar-2026 (Ley 47-25 con montos de PNP-01-2025):
THRESHOLDS += [
    {
        **t,
        "regime": "ley_47_25",
        "valid_from": date(2026, 1, 29),
        "valid_to": date(2026, 3, 31),
        "source_name": t["source_name"] + "; mantenidos por Resolución PNP-01-2026 art. 2",
        "notes": (t.get("notes") or "") + " Montos 2025 vigentes en la transición a la Ley 47-25.",
    }
    for t in THRESHOLDS
    if t["regime"] == "ley_340_06" and t["modality"] != "licitacion_restringida"  # abolida por PNP-01-2026 art. 6
]
for t in THRESHOLDS:
    if t["regime"] == "ley_340_06":
        t["valid_to"] = date(2026, 3, 31)

LEY_47_25_CUTOFF = date(2026, 1, 29)  # procesos convocados desde esta fecha se rigen por la Ley 47-25


def regime_for(convened_on: date) -> str:
    return "ley_47_25" if convened_on >= LEY_47_25_CUTOFF else "ley_340_06"


def modality_key(modality: str | None) -> str | None:
    """Traduce la modalidad registrada por la DGCP a la clave de umbral."""
    text = (modality or "").lower()
    if "debajo" in text or "directa sujeta" in text:
        return "debajo_umbral"
    if "menor" in text:
        return "compra_menor"
    if "comparaci" in text or "simplificada" in text:
        return "comparacion_precios"
    if "restringida" in text:
        return "licitacion_restringida"
    if "sorteo" in text:
        return "sorteo_obras"
    if "licitaci" in text:
        return "licitacion_publica"
    return None


def object_key(object_type: str | None) -> str:
    return "obras" if "obra" in (object_type or "").lower() else "bienes_servicios"


def seed_thresholds(session: Session) -> None:
    for t in THRESHOLDS:
        exists = session.execute(
            select(LegalThreshold.id).where(
                LegalThreshold.regime == t["regime"],
                LegalThreshold.modality == t["modality"],
                LegalThreshold.object_type == t["object_type"],
                LegalThreshold.valid_from == t["valid_from"],
            )
        ).scalar()
        if exists is None:
            session.add(LegalThreshold(**t))


def threshold_for(session: Session, modality: str, object_type: str, on: date) -> LegalThreshold | None:
    return session.execute(
        select(LegalThreshold)
        .where(
            LegalThreshold.regime == regime_for(on),
            LegalThreshold.modality == modality,
            LegalThreshold.object_type == object_type,
            LegalThreshold.verified.is_(True),
            LegalThreshold.valid_from <= on,
            (LegalThreshold.valid_to.is_(None)) | (LegalThreshold.valid_to >= on),
        )
        .order_by(LegalThreshold.valid_from.desc())
        .limit(1)
    ).scalar_one_or_none()


def as_decimal(value: str) -> Decimal:
    return Decimal(value)
