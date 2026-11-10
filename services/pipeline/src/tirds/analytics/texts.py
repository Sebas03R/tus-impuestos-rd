"""Textos de alertas generados con plantillas deterministas a partir de números ya calculados.
Nunca usan un modelo de lenguaje y nunca contienen acusaciones."""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]


def money(value: Decimal | None, currency: str = "DOP") -> str:
    if value is None:
        return "sin dato"
    q = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if q < 0 else ""
    text = f"{abs(q):,.2f}"
    prefix = {"DOP": "RD$", "USD": "US$", "EUR": "€"}.get(currency, currency + " ")
    return f"{sign}{prefix}{text}"


def pct(value: Decimal | None) -> str:
    if value is None:
        return "sin dato"
    return f"{value.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}%".replace(".", ",")


def number(value: Decimal | None) -> str:
    if value is None:
        return "sin dato"
    n = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP).normalize()
    return f"{n:,f}" if n != n.to_integral_value() else f"{int(n):,}"


def day(d: date | None) -> str:
    return "sin fecha" if d is None else f"{d.day} de {MONTHS[d.month - 1]} de {d.year}"


def shorten(text: str | None, n: int = 90) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


PRICE_EXPLANATIONS = [
    "Especificaciones técnicas distintas que la descripción registrada no detalla (marca, modelo, capacidad, calidad).",
    "Garantía, soporte, licencias, instalación, transporte o capacitación incluidos en el precio.",
    "Diferencias en la cantidad comprada (las compras pequeñas suelen tener precios unitarios más altos).",
    "Plazos de entrega urgentes, ubicación de entrega o condiciones de pago distintas.",
    "Cambios de precios en el mercado entre las fechas comparadas.",
    "Errores de registro en la unidad de medida, la cantidad o el precio en la fuente oficial.",
]

PRICE_LIMITATIONS = [
    "La comparación usa la descripción registrada en el portal; los documentos del proceso pueden contener detalles técnicos que la cambien.",
    "Los precios se comparan antes de impuestos y después de descuentos, por unidad de medida normalizada.",
    "Una diferencia de precio no es por sí sola un perjuicio económico ni una irregularidad.",
    "Solo se usan compras públicas registradas por la DGCP; no se usan precios de tiendas minoristas.",
]

PRICE_MISSING = [
    "Ficha técnica completa del artículo contratado y de las compras de referencia.",
    "Confirmación de qué servicios (garantía, transporte, instalación) incluye cada precio.",
    "Explicación de la institución sobre la elección del proveedor y el precio.",
]


def price_texts(
    item: str,
    institution: str | None,
    contracted: Decimal,
    reference: Decimal,
    diff_pct: Decimal,
    diff_total: Decimal,
    quantity: Decimal,
    unit: str,
    n_peers: int,
    n_inst: int,
    when: date,
) -> dict[str, str]:
    return {
        "title": f"Encontramos una diferencia de precio en la compra de {shorten(item, 70).lower()}",
        "summary": (
            f"{institution or 'Una institución'} contrató {number(quantity)} {unit} de «{shorten(item, 80)}» el "
            f"{day(when)}, a {money(contracted)} por unidad antes de impuestos."
        ),
        "why_flagged": (
            f"El precio unitario registrado es {pct(diff_pct)} superior al precio de referencia de {money(reference)}, "
            f"calculado como la mediana de {n_peers} compras comparables de {n_inst} instituciones. "
            f"Aplicado a la cantidad comprada, la diferencia estimada es de {money(diff_total)}."
        ),
    }
