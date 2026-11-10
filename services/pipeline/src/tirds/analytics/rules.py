"""Definición versionada de las reglas del Radar de Contrataciones.

Los parámetros iniciales son EXPERIMENTALES (ver /metodologia). Se editan creando una
nueva versión en detection_rules (desde /admin o CLI); nunca se sobrescribe una versión.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tirds.db.models import DetectionRule

PRICE = "precio"
SPLITTING = "fraccionamiento"
COMPETITION = "competencia_limitada"
CONCENTRATION = "adjudicaciones_recurrentes"
AMENDMENT = "incremento_contractual"
DOCUMENTS = "documentacion_insuficiente"
TEMPORAL = "patron_temporal"
STAGE_GAP = "diferencia_etapas"

PRIORITY = "prioridad"

DEFAULT_RULES: list[dict[str, Any]] = [
    {
        "code": PRICE,
        "name": "Posible diferencia de precio",
        "public_description": (
            "Compara el precio unitario de un artículo contratado con lo que pagaron otras instituciones "
            "por artículos equivalentes en fechas cercanas. Solo compara artículos de la misma categoría, "
            "con la misma unidad de medida, especificaciones numéricas compatibles y los mismos servicios incluidos."
        ),
        "technical_description": (
            "Referencia = mediana de precios unitarios antes de impuestos y después de descuentos, en DOP, de "
            "observaciones comparables (misma subclase UNSPSC, unidad normalizada, tratamiento de servicios, "
            "tokens numéricos compatibles, similitud de texto >= min_similarity, ventana +-window_days, "
            "banda de cantidad). Dispersión = MAD/mediana. Si la descripción del contrato no declara impuestos "
            "se asume el caso más favorable (que el precio incluye ITBIS)."
        ),
        "params": {
            "min_peers": 5,
            "min_institutions": 3,
            "min_similarity": 70,
            "min_sort_similarity": 70,
            "perishable_window_days": 90,
            "max_plausible_pct": 400,
            "window_days": 365,
            "max_dispersion": 0.3,
            "quantity_band_factor": 20,
            "min_diff_total_dop": 50000,
            "levels": {"interno": 15, "candidata": 30, "prioritaria": 60},
            "itbis_rate": 0.18,
        },
    },
    {
        "code": SPLITTING,
        "name": "Posible fraccionamiento",
        "public_description": (
            "Busca compras parecidas de una misma institución, hechas en pocos días por modalidades de menor "
            "control, cuya suma supera el monto a partir del cual correspondía una modalidad más competitiva "
            "según los umbrales oficiales vigentes en esa fecha."
        ),
        "technical_description": (
            "Agrupa procesos de una unidad de compra con la misma CLASE UNSPSC (rubro-clase) dentro de window_days "
            "(la Ley 47-25 define el fraccionamiento con 3 meses, art. 5 num. 20 y art. 81; el Radar usa 30 días "
            "para priorizar los casos más claros y evitar señalar compras recurrentes planificadas). "
            "Considera solo modalidades bajo umbral/compra menor. Alerta si la suma supera el umbral vigente de la "
            "modalidad siguiente (legal_thresholds verificados) y hay al menos min_processes procesos. Sin umbral "
            "verificado para la fecha, no se publica. Además, al menos min_near_cap procesos deben estar entre "
            "near_cap_ratio y el 100 % del límite (compras divididas cerca del umbral)."
        ),
        "params": {
            "window_days": 30,
            "min_processes": 3,
            "modalities": ["Compras por Debajo del Umbral", "Contratación Menor", "Compra Menor"],
            "ley_47_25_window_days": 30,
            "near_cap_ratio": 0.7,
            "min_near_cap": 3,
        },
    },
    {
        "code": COMPETITION,
        "name": "Competencia limitada",
        "public_description": (
            "Señala procesos competitivos (por ejemplo, comparación de precios o licitación) en los que solo se "
            "registró una oferta. Las compras de excepción o de emergencia no se consideran."
        ),
        "technical_description": (
            "Cuenta ofertas distintas por proceso (tabla bids, por RPE). Aplica solo a modalidades competitivas. "
            "Requiere que el proceso tenga contrato o adjudicación registrada y monto >= min_amount_dop."
        ),
        "params": {
            "competitive_modalities": [
                "Comparación de Precios",
                "Licitación Pública Nacional",
                "Licitación Pública Internacional",
                "Licitación Restringida",
                "Licitación Pública Abreviada",
                "Sorteo de Obras",
                "Subasta Inversa",
            ],
            "min_amount_dop": 1000000,
            "max_bids": 1,
        },
    },
    {
        "code": CONCENTRATION,
        "name": "Adjudicaciones recurrentes",
        "public_description": (
            "Muestra cuando un mismo proveedor concentra la mayor parte de lo contratado por una institución en "
            "una misma categoría durante un año. La concentración puede tener explicaciones legítimas."
        ),
        "technical_description": (
            "Por institución x familia UNSPSC x año: participación del proveedor en el monto contratado (DOP). "
            "Alerta si share >= min_share, hay >= min_contracts contratos del proveedor y el total del grupo es "
            ">= min_group_total_dop y existen >= min_suppliers_market proveedores en esa familia a nivel nacional."
        ),
        "params": {
            "min_share": 0.8,
            "min_contracts": 5,
            "min_group_total_dop": 5000000,
            "min_suppliers_market": 5,
        },
    },
    {
        "code": AMENDMENT,
        "name": "Incremento contractual",
        "public_description": (
            "Indica contratos cuyo monto aumentó mediante enmiendas registradas respecto del monto inicial."
        ),
        "technical_description": (
            "Usa enmiendas publicadas en OCDS (contract_amendments) o cambios observados del valor contratado en "
            "record_versions. Alerta si el incremento acumulado >= min_increase_pct."
        ),
        "params": {"min_increase_pct": 25, "min_increase_dop": 500000},
    },
    {
        "code": DOCUMENTS,
        "name": "Documentación insuficiente",
        "public_description": (
            "Señala procesos adjudicados en los que no encontramos publicados documentos básicos que normalmente "
            "deberían estar disponibles (por ejemplo, el acto de adjudicación)."
        ),
        "technical_description": (
            "Solo para procesos con documentos consultados (documents_checked_at) en modalidades competitivas y "
            "con contrato. Busca palabras clave del tipo de documento esperado. No se publica si la consulta fue "
            "hace menos de min_days_after_award días desde la adjudicación."
        ),
        "params": {
            "expected": {"adjudicacion": ["adjudic"], "pliego": ["pliego", "especificacion", "ficha", "termino"]},
            "min_days_after_award": 30,
        },
    },
    {
        "code": TEMPORAL,
        "name": "Patrón temporal inusual",
        "public_description": (
            "Destaca instituciones que concentran un volumen inusual de contratación directa en las últimas semanas "
            "del año fiscal comparado con el resto del año."
        ),
        "technical_description": (
            "Por institución y año: proporción del monto de modalidades no competitivas adjudicado en diciembre "
            "frente al promedio mensual. Alerta si ratio >= min_ratio y monto de diciembre >= min_amount_dop."
        ),
        "params": {"min_ratio": 4, "min_amount_dop": 10000000},
    },
    {
        "code": STAGE_GAP,
        "name": "Diferencia entre etapas",
        "public_description": (
            "Compara el monto estimado al publicar un proceso con el monto finalmente contratado. Para no "
            "exagerar, se supone que el monto estimado no incluía ITBIS y se descuenta del monto contratado."
        ),
        "technical_description": (
            "Para procesos con monto estimado y contratos en la misma moneda: (contratado/(1+itbis) / estimado - 1). "
            "Alerta si supera min_pct, la diferencia ajustada >= min_diff_dop y el proceso tiene como máximo "
            "max_contracts contratos (los procesos con muchos lotes suelen tener estimados parciales). Procesos "
            "lotificados se excluyen."
        ),
        "params": {
            "min_pct": 25,
            "min_diff_dop": 1000000,
            "itbis_rate": 0.18,
            "max_contracts": 10,
            "max_plausible_pct": 400,
        },
    },
    {
        "code": PRIORITY,
        "name": "Prioridad de revisión",
        "public_description": (
            "Ordena las alertas según la evidencia disponible y el dinero involucrado. No es una probabilidad de "
            "irregularidad ni una calificación de personas o instituciones."
        ),
        "technical_description": (
            "Puntaje 0-100 = 35% desviación de precio + 30% magnitud económica (log10) + 20% competencia + "
            "15% documentación. La confianza de la evidencia (A/B/C) se reporta por separado."
        ),
        "params": {
            "weights": {"precio": 35, "magnitud": 30, "competencia": 20, "documentacion": 15},
            "magnitude_log10_floor": 4,
            "magnitude_log10_ceiling": 9,
            "priority_label_threshold": 60,
        },
    },
]


def seed_rules(session: Session) -> None:
    for rule in DEFAULT_RULES:
        stmt = insert(DetectionRule).values(version=1, change_note="Versión inicial experimental", **rule)
        session.execute(stmt.on_conflict_do_nothing(index_elements=["code", "version"]))


def active_rules(session: Session) -> dict[str, DetectionRule]:
    """Última versión activa de cada regla."""
    latest = select(DetectionRule.code, func.max(DetectionRule.version).label("v")).group_by(DetectionRule.code).subquery()
    rows = session.execute(
        select(DetectionRule).join(latest, (DetectionRule.code == latest.c.code) & (DetectionRule.version == latest.c.v))
    ).scalars()
    return {r.code: r for r in rows}
