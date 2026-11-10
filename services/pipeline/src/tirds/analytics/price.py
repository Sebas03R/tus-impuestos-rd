"""Comparación de precios unitarios contra compras equivalentes (determinista y reproducible).

Fórmulas (solo con bases normalizadas):
    diferencia_unitaria  = precio_contratado - precio_referencia
    variacion_porcentual = (precio_contratado / precio_referencia - 1) * 100
    diferencia_total     = diferencia_unitaria * cantidad
La diferencia calculada NO es un perjuicio patrimonial: es un indicio para revisión.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from rapidfuzz import fuzz, process

ZERO = Decimal(0)
HUNDRED = Decimal(100)


@dataclass(slots=True)
class Observation:
    item_id: int
    contract_id: int
    contract_code: str
    process_id: int | None
    institution_id: int | None
    institution_name: str | None
    supplier_id: int | None
    subclass: str
    unit_norm: str
    quantity: Decimal
    price_dop: Decimal  # antes de impuestos y después de descuentos, DOP por unidad normalizada
    tax_treatment: str
    service_flags: frozenset[str]
    qualifiers: frozenset[str]
    dims: dict[str, frozenset[str]]
    text: str
    observed_on: date
    description: str
    official_url: str | None
    currency_original: str = "DOP"
    fx_rate: Decimal | None = None
    item_name: str = ""

    @property
    def pool_key(self) -> tuple[Any, ...]:
        return (self.subclass, self.unit_norm, self.service_flags, self.qualifiers)


@dataclass
class Peer:
    obs: Observation
    similarity: Decimal


@dataclass
class PriceResult:
    subject: Observation
    level: str  # sin_alerta | interno | candidata | prioritaria | informacion_insuficiente
    evidence_grade: str  # A | B | C
    contracted_price: Decimal
    reference_price: Decimal | None
    diff_unit: Decimal | None
    diff_pct: Decimal | None
    diff_total: Decimal | None
    n_peers: int
    n_institutions: int
    mad: Decimal | None
    iqr: Decimal | None
    dispersion: Decimal | None
    tax_assumption: str
    window_from: date
    window_to: date
    peers: list[Peer] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def publishable(self) -> bool:
        return self.level in {"candidata", "prioritaria"} and self.evidence_grade in {"A", "B"}


def q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def q4(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def median(values: list[Decimal]) -> Decimal:
    s = sorted(values)
    n = len(s)
    if n == 0:
        raise ValueError("lista vacía")
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def quantile(values: list[Decimal], q: Decimal) -> Decimal:
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def classify(diff_pct: Decimal, levels: dict[str, Any]) -> str:
    if diff_pct >= Decimal(str(levels["prioritaria"])):
        return "prioritaria"
    if diff_pct >= Decimal(str(levels["candidata"])):
        return "candidata"
    if diff_pct >= Decimal(str(levels["interno"])):
        return "interno"
    return "sin_alerta"


class PriceComparer:
    """Índice de observaciones por grupo comparable y comparación de sujetos contra pares."""

    def __init__(self, observations: Iterable[Observation], params: dict[str, Any]):
        self.params = params
        self.pools: dict[tuple[Any, ...], list[Observation]] = defaultdict(list)
        for o in observations:
            self.pools[o.pool_key].append(o)
        self._texts: dict[tuple[Any, ...], list[str]] = {k: [o.text for o in v] for k, v in self.pools.items()}

    def compare_many(self, subjects: list[Observation]) -> list[PriceResult]:
        by_pool: dict[tuple[Any, ...], list[Observation]] = defaultdict(list)
        for s in subjects:
            by_pool[s.pool_key].append(s)
        results: list[PriceResult] = []
        min_sim = float(self.params["min_similarity"])
        for key, subs in by_pool.items():
            pool = self.pools.get(key, [])
            if len(pool) <= 1:
                results.extend(self._evaluate(s, []) for s in subs)
                continue
            scores = process.cdist(
                [s.text for s in subs],
                self._texts[key],
                scorer=fuzz.token_set_ratio,
                score_cutoff=min_sim,
                workers=-1,
            )
            min_sort = float(self.params.get("min_sort_similarity", 55))
            for i, s in enumerate(subs):
                row = scores[i]
                cands = [
                    Peer(pool[j], Decimal(str(round(float(row[j]), 2))))
                    for j in row.nonzero()[0]
                    # token_set_ratio da 100 si un texto contiene al otro ("mascarilla" ⊂ "mascarilla n95");
                    # token_sort_ratio penaliza palabras de más y evita esas falsas equivalencias.
                    if fuzz.token_sort_ratio(s.text, pool[j].text) >= min_sort
                ]
                results.append(self._evaluate(s, cands))
        return results

    def compare(self, subject: Observation) -> PriceResult:
        return self.compare_many([subject])[0]

    def _evaluate(self, s: Observation, candidates: list[Peer]) -> PriceResult:
        p = self.params
        # Perecederos (segmento 50: alimentos) cambian de precio rápido: ventana más corta.
        days = int(p.get("perishable_window_days", 90)) if s.subclass.startswith("50") else int(p["window_days"])
        window = timedelta(days=days)
        band = Decimal(str(p["quantity_band_factor"]))
        rate = Decimal(str(p["itbis_rate"]))
        w_from, w_to = s.observed_on - window, s.observed_on + window

        # Supuesto más favorable al contratado: si no declaró impuestos, se asume que su precio los incluye.
        if s.tax_treatment == "sin_impuesto_declarado":
            contracted = s.price_dop / (1 + rate)
            tax_assumption = (
                "El contrato no detalla impuestos; para no exagerar la diferencia asumimos que su precio ya "
                "incluye ITBIS (18%) y lo descontamos."
            )
        else:
            contracted = s.price_dop
            tax_assumption = "Se comparan precios antes de impuestos, tal como los registra la DGCP."

        peers = [
            c
            for c in candidates
            if c.obs.item_id != s.item_id
            and c.obs.contract_id != s.contract_id
            and (s.process_id is None or c.obs.process_id != s.process_id)
            and w_from <= c.obs.observed_on <= w_to
            and s.quantity / band <= c.obs.quantity <= s.quantity * band
            and _dims_ok(s.dims, c.obs.dims, s.subclass, s.unit_norm)
        ]
        # Líneas idénticas duplicadas en la fuente cuentan una sola vez.
        unique: dict[tuple[object, ...], Peer] = {}
        for c in peers:
            unique.setdefault((c.obs.contract_id, c.obs.text, c.obs.price_dop, c.obs.quantity), c)
        peers = list(unique.values())
        # Independencia: una referencia por proceso (mediana de sus líneas).
        per_process: dict[Any, list[Peer]] = defaultdict(list)
        for c in peers:
            per_process[c.obs.process_id or f"c{c.obs.contract_id}"].append(c)
        process_prices = [median([c.obs.price_dop for c in group]) for group in per_process.values()]
        institutions = {c.obs.institution_id for c in peers if c.obs.institution_id is not None}

        base = dict(
            subject=s,
            contracted_price=q4(contracted),
            tax_assumption=tax_assumption,
            window_from=w_from,
            window_to=w_to,
            peers=sorted(peers, key=lambda c: (-c.similarity, c.obs.item_id))[:60],
            n_peers=len(process_prices),
            n_institutions=len(institutions),
        )
        if not process_prices:
            return PriceResult(
                level="informacion_insuficiente",
                evidence_grade="C",
                reference_price=None,
                diff_unit=None,
                diff_pct=None,
                diff_total=None,
                mad=None,
                iqr=None,
                dispersion=None,
                notes=["No se encontraron compras comparables."],
                **base,
            )

        reference = median(process_prices)
        mad = median([abs(x - reference) for x in process_prices])
        iqr = quantile(process_prices, Decimal("0.75")) - quantile(process_prices, Decimal("0.25"))
        dispersion = mad / reference if reference > 0 else None
        diff_unit = contracted - reference
        diff_pct = (contracted / reference - 1) * HUNDRED if reference > 0 else None
        diff_total = diff_unit * s.quantity

        notes: list[str] = []
        enough = len(process_prices) >= int(p["min_peers"]) and len(institutions) >= int(p["min_institutions"])
        if not enough:
            notes.append(
                f"Solo {len(process_prices)} compras comparables de {len(institutions)} instituciones; "
                f"se requieren al menos {p['min_peers']} de {p['min_institutions']}."
            )
        dispersed = dispersion is not None and dispersion > Decimal(str(p["max_dispersion"]))
        if dispersed:
            notes.append("Los precios de referencia varían demasiado entre sí para fijar una referencia confiable.")
        grade = "B" if enough and not dispersed else "C"

        if diff_pct is None:
            level = "informacion_insuficiente"
        else:
            level = classify(diff_pct, p["levels"])
            if level in {"candidata", "prioritaria"} and grade == "C":
                level = "informacion_insuficiente"
            if level in {"candidata", "prioritaria"} and diff_pct > Decimal(str(p.get("max_plausible_pct", 400))):
                notes.append(
                    "La diferencia es tan grande que probablemente se deba a un error de registro (unidad, cantidad o "
                    "precio) en la fuente; requiere verificación antes de cualquier conclusión."
                )
                level = "informacion_insuficiente"
            if level in {"candidata", "prioritaria"} and diff_total < Decimal(str(p["min_diff_total_dop"])):
                notes.append("La diferencia total estimada es menor que el mínimo configurado para publicar.")
                level = "interno"
        return PriceResult(
            level=level,
            evidence_grade=grade,
            reference_price=q4(reference),
            diff_unit=q4(diff_unit),
            diff_pct=q2(diff_pct) if diff_pct is not None else None,
            diff_total=q2(diff_total),
            mad=q4(mad),
            iqr=q4(iqr),
            dispersion=q4(dispersion) if dispersion is not None else None,
            notes=notes,
            **base,
        )


def _dims_ok(a: dict[str, frozenset[str]], b: dict[str, frozenset[str]], subclass: str = "", unit: str = "") -> bool:
    """Por pieza ("unidad"), el tamaño declarado (peso/volumen) define el producto: debe coincidir."""
    from tirds.analytics.normalize import MEDICINE_STRICT_DIMS, STRICT_DIMS, specs_compatible

    strict = MEDICINE_STRICT_DIMS if subclass.startswith("51") or unit == "unidad" else STRICT_DIMS
    return specs_compatible(a, b, strict=strict)
