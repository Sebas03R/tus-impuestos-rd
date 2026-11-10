"""Motor de Análisis de Contrataciones: orquesta reglas, evidencia, prioridad y publicación."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from tirds.analytics import rules as R
from tirds.analytics import texts as T
from tirds.analytics.normalize import normalize_item
from tirds.analytics.price import Observation, PriceComparer, PriceResult
from tirds.analytics.thresholds import modality_key, object_key, regime_for
from tirds.config import get_settings
from tirds.db import models as m
from tirds.db.session import advisory_lock, session_scope
from tirds.publish.alerts import AlertCandidate, AlertPublisher

log = structlog.get_logger()


# ---------------------------------------------------------------------- tasas de cambio


class FxTable:
    """Tasas BCRD (DOP por unidad de moneda extranjera). Busca la tasa del día o la anterior (≤7 días)."""

    def __init__(self, session: Session):
        self.rates: dict[str, list[tuple[date, Decimal]]] = defaultdict(list)
        for d, cur, buy, sell in session.execute(
            select(m.ExchangeRate.rate_date, m.ExchangeRate.currency, m.ExchangeRate.buy, m.ExchangeRate.sell).order_by(
                m.ExchangeRate.rate_date
            )
        ):
            rate = sell or buy
            if rate:
                self.rates[cur].append((d, rate))

    def rate(self, currency: str | None, on: date) -> Decimal | None:
        if currency in (None, "DOP"):
            return Decimal(1)
        series = self.rates.get(currency or "")
        if not series:
            return None
        best = None
        for d, r in series:
            if d > on:
                break
            best = (d, r)
        if best is None or (on - best[0]).days > 7:
            return None
        return best[1]


# ---------------------------------------------------------------------- precio


OBS_SQL = text(
    """
    SELECT ci.id, ci.contract_id, c.code, c.process_id, c.institution_id, i.name AS institution_name, c.supplier_id,
           ci.unspsc_subclass, ci.item_name, ci.user_description, ci.unit, ci.quantity, ci.unit_price, ci.itbis,
           ci.other_taxes, ci.discounts, ci.total, c.currency,
           (coalesce(c.awarded_at, c.created_at_source) AT TIME ZONE 'America/Santo_Domingo')::date AS observed_on,
           c.official_url, c.first_seen_at
    FROM contract_items ci
    JOIN contracts c ON c.id = ci.contract_id
    LEFT JOIN institutions i ON i.id = c.institution_id
    WHERE coalesce(c.awarded_at, c.created_at_source) >= :since
      AND c.is_demo = :demo
      AND coalesce(c.status, '') NOT ILIKE '%cancel%'
    """
)


def load_observations(session: Session, since: date, demo: bool, fx: FxTable) -> tuple[list[Observation], dict[int, Any]]:
    obs: list[Observation] = []
    meta: dict[int, Any] = {}
    excluded: dict[str, int] = defaultdict(int)
    result = session.execute(OBS_SQL.execution_options(yield_per=5000), {"since": since, "demo": demo})
    for r in result:
        n = normalize_item(
            subclass=r.unspsc_subclass,
            item_name=r.item_name,
            user_description=r.user_description,
            unit=r.unit,
            quantity=r.quantity,
            unit_price=r.unit_price,
            itbis=r.itbis,
            other_taxes=r.other_taxes,
            discounts=r.discounts,
            total=r.total,
        )
        if not n.comparable or r.observed_on is None:
            excluded[n.exclusion_reason or "sin_fecha"] += 1
            continue
        rate = fx.rate(r.currency, r.observed_on)
        if rate is None:
            excluded["sin_tasa_de_cambio"] += 1
            continue
        assert n.unit_price_pretax is not None and n.quantity_norm is not None and n.unit_norm is not None
        o = Observation(
            item_id=r.id,
            contract_id=r.contract_id,
            contract_code=r.code,
            process_id=r.process_id,
            institution_id=r.institution_id,
            institution_name=r.institution_name,
            supplier_id=r.supplier_id,
            subclass=r.unspsc_subclass,
            unit_norm=n.unit_norm,
            quantity=n.quantity_norm,
            price_dop=n.unit_price_pretax * rate,
            tax_treatment=n.tax_treatment,
            service_flags=n.service_flags,
            qualifiers=n.qualifiers,
            dims=n.dims,
            text=n.text,
            observed_on=r.observed_on,
            description=(r.user_description or r.item_name or "").strip()[:300],
            official_url=r.official_url,
            currency_original=r.currency or "DOP",
            fx_rate=rate if r.currency not in (None, "DOP") else None,
            item_name=(r.item_name or "").strip(),
        )
        obs.append(o)
        meta[o.item_id] = {"first_seen_at": r.first_seen_at, "item_name": r.item_name, "spec_tokens": n.spec_tokens}
    log.info("price_observations", comparable=len(obs), excluded=dict(excluded))
    return obs, {"items": meta, "excluded": dict(excluded)}


def price_candidate(res: PriceResult, rule: m.DetectionRule, inst_names: dict[int, str], unit_label: str) -> AlertCandidate:
    s = res.subject
    assert res.reference_price is not None and res.diff_pct is not None and res.diff_total is not None
    t = T.price_texts(
        s.description or s.item_name or "artículo",
        s.institution_name,
        res.contracted_price,
        res.reference_price,
        res.diff_pct,
        res.diff_total,
        s.quantity,
        unit_label,
        res.n_peers,
        res.n_institutions,
        s.observed_on,
    )
    evidence: list[dict[str, Any]] = [
        {
            "kind": "registro",
            "label": f"Contrato {s.contract_code} en el portal de Compras Dominicana",
            "entity": "contract",
            "entity_id": s.contract_id,
            "source_url": s.official_url,
            "data": {"contract_code": s.contract_code, "description": s.description},
        },
        {
            "kind": "calculo",
            "label": "Precio de referencia",
            "data": {
                "formula": "mediana de precios unitarios de compras comparables (una por proceso)",
                "values": {
                    "referencia": str(res.reference_price),
                    "compras": res.n_peers,
                    "instituciones": res.n_institutions,
                    "dispersion_mad_sobre_mediana": str(res.dispersion),
                },
            },
        },
        {
            "kind": "calculo",
            "label": "Diferencia unitaria",
            "data": {
                "formula": "precio_contratado - precio_referencia",
                "values": {
                    "precio_contratado": str(res.contracted_price),
                    "precio_referencia": str(res.reference_price),
                    "resultado": str(res.diff_unit),
                },
            },
        },
        {
            "kind": "calculo",
            "label": "Variación porcentual",
            "data": {
                "formula": "((precio_contratado / precio_referencia) - 1) * 100",
                "values": {"resultado": str(res.diff_pct)},
            },
        },
        {
            "kind": "calculo",
            "label": "Diferencia total estimada",
            "data": {
                "formula": "diferencia_unitaria * cantidad",
                "values": {
                    "diferencia_unitaria": str(res.diff_unit),
                    "cantidad": str(s.quantity),
                    "resultado": str(res.diff_total),
                },
            },
        },
    ]
    for peer in res.peers:
        o = peer.obs
        evidence.append(
            {
                "kind": "referencia",
                "label": f"Compra comparable {o.contract_code}",
                "entity": "contract",
                "entity_id": o.contract_id,
                "source_url": o.official_url,
                "data": {
                    "contract_code": o.contract_code,
                    "institution": o.institution_name or inst_names.get(o.institution_id or 0),
                    "date": o.observed_on.isoformat(),
                    "unit_price": str(o.price_dop.quantize(Decimal("0.0001"))),
                    "quantity": str(o.quantity),
                    "description": o.description,
                    "similarity": str(peer.similarity),
                    "url": o.official_url,
                },
            }
        )
    limitations = list(T.PRICE_LIMITATIONS) + [res.tax_assumption] + res.notes
    if s.currency_original != "DOP":
        limitations.append(
            f"El contrato está en {s.currency_original}; se convirtió a pesos con la tasa del BCRD "
            f"de la fecha del contrato ({s.fx_rate})."
        )
    return AlertCandidate(
        rule_code=R.PRICE,
        rule_version=rule.version,
        subject_key=f"contract_item:{s.item_id}",
        publishable=res.publishable,
        title=t["title"],
        summary=t["summary"],
        why_flagged=t["why_flagged"],
        possible_explanations=list(T.PRICE_EXPLANATIONS),
        missing_information=list(T.PRICE_MISSING),
        limitations=limitations,
        metrics={
            "item_description": s.description,
            "unit": unit_label,
            "quantity": s.quantity,
            "contracted_price": res.contracted_price,
            "reference_price": res.reference_price,
            "diff_unit": res.diff_unit,
            "diff_pct": res.diff_pct,
            "diff_total": res.diff_total,
            "n_peers": res.n_peers,
            "n_institutions": res.n_institutions,
            "dispersion": res.dispersion,
            "window_from": res.window_from,
            "window_to": res.window_to,
            "tax_assumption": res.tax_assumption,
            "level": res.level,
            "currency": "DOP",
        },
        evidence_grade=res.evidence_grade,
        amount_involved=res.diff_total if res.diff_total and res.diff_total > 0 else None,
        event_date=s.observed_on,
        process_id=s.process_id,
        contract_id=s.contract_id,
        institution_id=s.institution_id,
        supplier_id=s.supplier_id,
        official_url=s.official_url,
        price_component=float(min(Decimal(100), res.diff_pct)),
        evidence=evidence,
        priority_hint=res.level == "prioritaria",
    )


UNIT_LABELS = {
    "unidad": "unidades",
    "kg": "kilogramos",
    "litro": "litros",
    "metro": "metros",
    "m2": "metros cuadrados",
    "m3": "metros cúbicos",
    "resma": "resmas",
    "par": "pares",
    "hora": "horas",
    "dia": "días",
    "mes": "meses",
}


def unit_label(unit_norm: str) -> str:
    if unit_norm in UNIT_LABELS:
        return UNIT_LABELS[unit_norm]
    if "_" in unit_norm:
        base, size = unit_norm.rsplit("_", 1)
        return f"{base}s de {size}"
    return unit_norm


def run_price_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date, run_id: int
) -> dict[str, Any]:
    p = rule.params
    fx = FxTable(session)
    window_start = since - timedelta(days=int(p["window_days"]))
    observations, meta = load_observations(session, window_start, demo, fx)
    comparer = PriceComparer(observations, p)
    min_total = Decimal(str(p["min_diff_total_dop"]))
    subjects = []
    seen_lines: set[tuple[object, ...]] = set()
    for o in observations:
        if o.observed_on < since or o.price_dop * o.quantity < min_total:
            continue
        # Líneas idénticas del mismo contrato (duplicadas en la fuente) generan una sola evaluación.
        key = (o.contract_id, o.subclass, o.text, o.price_dop, o.quantity)
        if key in seen_lines:
            continue
        seen_lines.add(key)
        subjects.append(o)
    started = time.monotonic()
    results = comparer.compare_many(subjects)
    log.info("price_compared", subjects=len(subjects), seconds=round(time.monotonic() - started, 1))

    inst_names = dict(session.execute(select(m.Institution.id, m.Institution.name)).all())
    levels: dict[str, int] = defaultdict(int)
    evaluated: set[str] = set()
    for res in results:
        levels[res.level] += 1
        evaluated.add(f"contract_item:{res.subject.item_id}")
        alertable = res.level in {"candidata", "prioritaria"} or (
            res.level == "informacion_insuficiente"
            and res.diff_pct is not None
            and res.diff_pct >= Decimal(str(p["levels"]["candidata"]))
            and res.n_peers >= 2
            and res.diff_total is not None
            and res.diff_total >= Decimal(str(p["min_diff_total_dop"]))
        )
        if not alertable:
            continue
        _persist_comparison(session, res, rule, run_id, meta["items"])
        pub.apply(price_candidate(res, rule, inst_names, unit_label(res.subject.unit_norm)))
    retired = pub.retire_missing(R.PRICE, evaluated)
    return {
        "observaciones_comparables": len(observations),
        "sujetos_evaluados": len(subjects),
        "niveles": dict(levels),
        "excluidas": meta["excluded"],
        "retiradas": retired,
    }


def _persist_comparison(
    session: Session, res: PriceResult, rule: m.DetectionRule, run_id: int, meta: dict[int, Any]
) -> None:
    from sqlalchemy.dialects.postgresql import insert

    def obs_id(o: Observation) -> int:
        values = dict(
            contract_item_id=o.item_id,
            contract_id=o.contract_id,
            process_id=o.process_id,
            institution_id=o.institution_id,
            supplier_id=o.supplier_id,
            unspsc_subclass=o.subclass,
            unit_norm=o.unit_norm,
            quantity_norm=o.quantity,
            unit_price_dop=o.price_dop.quantize(Decimal("0.0001")),
            tax_treatment=o.tax_treatment,
            currency_original=o.currency_original,
            fx_rate=o.fx_rate,
            service_flags=sorted(o.service_flags),
            spec_tokens=meta.get(o.item_id, {}).get("spec_tokens", []),
            text_norm=o.text[:500],
            observed_on=o.observed_on,
            comparable=True,
            exclusion_reason=None,
        )
        stmt = insert(m.PriceObservation).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["contract_item_id"], set_={k: stmt.excluded[k] for k in values if k != "contract_item_id"}
        )
        return session.execute(stmt.returning(m.PriceObservation.id)).scalar_one()

    subject_id = obs_id(res.subject)
    comp = m.PriceComparison(
        detection_run_id=run_id,
        observation_id=subject_id,
        rule_version=rule.version,
        reference_price=res.reference_price,
        contracted_price=res.contracted_price,
        n_peers=res.n_peers,
        n_institutions=res.n_institutions,
        mad=res.mad,
        iqr=res.iqr,
        dispersion=res.dispersion,
        diff_unit=res.diff_unit,
        diff_pct=res.diff_pct,
        diff_total=res.diff_total,
        quantity=res.subject.quantity,
        level=res.level,
        evidence_grade=res.evidence_grade,
        notes=res.notes,
    )
    session.add(comp)
    session.flush()
    peers = {}
    for peer in res.peers:
        peers[obs_id(peer.obs)] = peer
    if peers:
        session.execute(
            insert(m.PriceComparisonPeer),
            [
                {
                    "comparison_id": comp.id,
                    "observation_id": oid,
                    "similarity": p.similarity,
                    "unit_price_dop": p.obs.price_dop.quantize(Decimal("0.0001")),
                }
                for oid, p in peers.items()
            ],
        )


# ---------------------------------------------------------------------- reglas SQL


def _amount_dop_sql(alias: str = "c") -> str:
    return f"CASE WHEN {alias}.currency = 'DOP' THEN {alias}.amount END"


def run_competition_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    p = rule.params
    rows = session.execute(
        text(
            """
        WITH proc AS (
          SELECT p.id, p.code, p.title, p.modality, p.institution_id, i.name AS institution, p.official_url,
                 (p.published_at AT TIME ZONE 'America/Santo_Domingo')::date AS published_on,
                 (SELECT sum(c.amount) FROM contracts c WHERE c.process_id = p.id AND c.currency = 'DOP') AS contracted,
                 (SELECT count(*) FROM contracts c WHERE c.process_id = p.id) AS n_contracts,
                 (SELECT count(DISTINCT coalesce(b.supplier_rpe::text, b.supplier_name)) FROM bids b WHERE b.process_id = p.id) AS bidders,
                 (SELECT min(b.supplier_id) FROM bids b WHERE b.process_id = p.id) AS supplier_id
          FROM procurement_processes p LEFT JOIN institutions i ON i.id = p.institution_id
          WHERE p.modality = ANY(:mods) AND p.published_at >= :since AND p.is_demo = :demo
            AND coalesce(p.exception_type, '') NOT ILIKE '%%urgencia%%' AND coalesce(p.exception_type, '') NOT ILIKE '%%emergencia%%'
        )
        SELECT * FROM proc WHERE n_contracts > 0 AND bidders BETWEEN 1 AND :max_bids AND contracted >= :min_amount
        """
        ),
        {
            "mods": p["competitive_modalities"],
            "since": since,
            "demo": demo,
            "max_bids": p["max_bids"],
            "min_amount": p["min_amount_dop"],
        },
    ).all()
    for r in rows:
        pub.apply(
            AlertCandidate(
                rule_code=R.COMPETITION,
                rule_version=rule.version,
                subject_key=f"process:{r.id}",
                publishable=True,
                title=f"Solo una empresa presentó oferta en un proceso de {r.modality.lower()}",
                summary=(
                    f"{r.institution or 'Una institución'} realizó el proceso {r.code} («{T.shorten(r.title, 90)}») por "
                    f"{r.modality.lower()}, publicado el {T.day(r.published_on)}, y contrató {T.money(r.contracted)}."
                ),
                why_flagged=(
                    "En los datos oficiales de ofertas aparece una sola empresa oferente. En una modalidad "
                    "competitiva, recibir una única oferta reduce la comparación de precios y condiciones."
                ),
                possible_explanations=[
                    "El bien o servicio tiene pocos proveedores en el país.",
                    "Plazos de presentación cortos o requisitos muy específicos.",
                    "Otras empresas presentaron ofertas que no quedaron registradas en el portal (por ejemplo, ofertas físicas).",
                ],
                missing_information=[
                    "Acta de apertura de ofertas y acta de adjudicación.",
                    "Lista de empresas que retiraron el pliego o hicieron preguntas.",
                ],
                limitations=[
                    "Se cuentan las ofertas publicadas en el portal de la DGCP; pueden faltar ofertas no digitalizadas.",
                    "Recibir una sola oferta no es irregular por sí mismo.",
                ],
                metrics={
                    "modalidad": r.modality,
                    "ofertas_registradas": r.bidders,
                    "monto_contratado": r.contracted,
                    "currency": "DOP",
                },
                evidence_grade="B",
                amount_involved=r.contracted,
                event_date=r.published_on,
                process_id=r.id,
                institution_id=r.institution_id,
                supplier_id=r.supplier_id,
                official_url=r.official_url,
                competition_component=100.0,
                evidence=[
                    {
                        "kind": "registro",
                        "label": f"Proceso {r.code}",
                        "entity": "process",
                        "entity_id": r.id,
                        "source_url": r.official_url,
                        "data": {"process_code": r.code},
                    },
                    {
                        "kind": "calculo",
                        "label": "Conteo de oferentes",
                        "data": {
                            "formula": "cantidad de empresas distintas (RPE) con ofertas registradas en el proceso",
                            "values": {"oferentes": r.bidders},
                        },
                    },
                ],
            )
        )
    retired = pub.retire_missing(R.COMPETITION)
    return {"alertas": len(rows), "retiradas": retired}


def run_stage_gap_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    p = rule.params
    rows = session.execute(
        text(
            """
        SELECT p.id, p.code, p.title, p.modality, p.institution_id, i.name AS institution, p.official_url,
               p.estimated_amount, sum(c.amount) AS contracted, count(c.id) AS n_contracts,
               (min(coalesce(c.awarded_at, c.created_at_source)) AT TIME ZONE 'America/Santo_Domingo')::date AS awarded_on,
               min(c.supplier_id) AS supplier_id
        FROM procurement_processes p
        JOIN contracts c ON c.process_id = p.id AND c.currency = p.currency
        LEFT JOIN institutions i ON i.id = p.institution_id
        WHERE p.estimated_amount > 0 AND p.currency = 'DOP' AND p.published_at >= :since AND p.is_demo = :demo
          AND coalesce(p.is_lotified, false) = false AND coalesce(c.status, '') NOT ILIKE '%%cancel%%'
        GROUP BY p.id, i.name
        HAVING count(c.id) <= :max_contracts
           AND sum(c.amount) / (1 + :itbis) > p.estimated_amount * (1 + :pct / 100.0)
           AND sum(c.amount) / (1 + :itbis) - p.estimated_amount >= :min_diff
        """
        ),
        {
            "since": since,
            "demo": demo,
            "pct": p["min_pct"],
            "min_diff": p["min_diff_dop"],
            "itbis": p.get("itbis_rate", 0.18),
            "max_contracts": p.get("max_contracts", 10),
        },
    ).all()
    itbis = Decimal(str(p.get("itbis_rate", 0.18)))
    for r in rows:
        adjusted = (r.contracted / (1 + itbis)).quantize(Decimal("0.01"))
        diff = adjusted - r.estimated_amount
        gap = (adjusted / r.estimated_amount - 1) * 100
        # Diferencias desmesuradas suelen ser errores de registro (moneda o monto): quedan internas.
        plausible = gap <= Decimal(str(p.get("max_plausible_pct", 400)))
        pub.apply(
            AlertCandidate(
                rule_code=R.STAGE_GAP,
                rule_version=rule.version,
                subject_key=f"process:{r.id}",
                publishable=plausible,
                title="El monto contratado superó el monto estimado al publicar la compra",
                summary=(
                    f"En el proceso {r.code} de {r.institution or 'una institución'} («{T.shorten(r.title, 90)}») se "
                    f"estimó {T.money(r.estimated_amount)} y se contrataron {T.money(r.contracted)}."
                ),
                why_flagged=(
                    f"Aun descontando el ITBIS (por si el estimado no lo incluía), lo contratado es {T.pct(gap)} mayor "
                    f"que lo estimado ({T.money(diff)} más). Un aumento grande entre etapas merece revisar cómo se "
                    "calculó el presupuesto."
                ),
                possible_explanations=[
                    "El monto estimado inicial estaba desactualizado o incompleto.",
                    "Se ampliaron cantidades o alcance antes de contratar.",
                    "Errores de registro del monto estimado en el portal.",
                ],
                missing_information=[
                    "Estudio de mercado o presupuesto base del proceso.",
                    "Justificación de la diferencia en el informe de evaluación o adjudicación.",
                ],
                limitations=[
                    "Se suman todos los contratos registrados del proceso en la misma moneda.",
                    "El monto estimado es el registrado al publicar; no incluye enmiendas posteriores al pliego.",
                    "Se descontó 18 % de ITBIS del monto contratado para no exagerar la diferencia.",
                ],
                metrics={
                    "monto_estimado": r.estimated_amount,
                    "monto_contratado": r.contracted,
                    "monto_contratado_sin_itbis": adjusted,
                    "diferencia": diff,
                    "diferencia_pct": gap.quantize(Decimal("0.01")),
                    "contratos": r.n_contracts,
                    "currency": "DOP",
                },
                evidence_grade="B",
                amount_involved=diff,
                event_date=r.awarded_on,
                process_id=r.id,
                institution_id=r.institution_id,
                supplier_id=r.supplier_id,
                official_url=r.official_url,
                price_component=float(min(Decimal(100), gap)) * 0.5,
                evidence=[
                    {
                        "kind": "registro",
                        "label": f"Proceso {r.code}",
                        "entity": "process",
                        "entity_id": r.id,
                        "source_url": r.official_url,
                        "data": {"process_code": r.code},
                    },
                    {
                        "kind": "calculo",
                        "label": "Diferencia entre etapas",
                        "data": {
                            "formula": "((monto_contratado / 1.18) / monto_estimado - 1) * 100",
                            "values": {
                                "monto_estimado": str(r.estimated_amount),
                                "monto_contratado": str(r.contracted),
                                "monto_contratado_sin_itbis": str(adjusted),
                                "resultado": str(gap.quantize(Decimal("0.01"))),
                            },
                        },
                    },
                ],
            )
        )
    retired = pub.retire_missing(R.STAGE_GAP)
    return {"alertas": len(rows), "retiradas": retired}


def run_splitting_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    """Posible fraccionamiento con umbrales históricos versionados."""
    p = rule.params
    rows = session.execute(
        text(
            """
        SELECT p.id, p.code, p.title, p.modality, p.object_type, p.institution_id, i.name AS institution, p.official_url,
               (p.published_at AT TIME ZONE 'America/Santo_Domingo')::date AS published_on,
               coalesce((SELECT sum(c.amount) FROM contracts c WHERE c.process_id = p.id AND c.currency = 'DOP'),
                        CASE WHEN p.currency = 'DOP' THEN p.estimated_amount END) AS amount,
               (SELECT mode() WITHIN GROUP (ORDER BY f) FROM (
                    SELECT left(pi.unspsc_subclass, 6) || '00' AS f FROM procurement_items pi WHERE pi.process_id = p.id
                    UNION ALL
                    SELECT ci.unspsc_class FROM contract_items ci JOIN contracts c2 ON c2.id = ci.contract_id
                    WHERE c2.process_id = p.id) fam) AS family
        FROM procurement_processes p LEFT JOIN institutions i ON i.id = p.institution_id
        WHERE p.modality = ANY(:mods) AND p.published_at >= :since AND p.is_demo = :demo
          AND coalesce(p.status, '') NOT ILIKE '%%cancel%%' AND coalesce(p.status, '') NOT ILIKE '%%desierto%%'
        """
        ),
        {"mods": p["modalities"], "since": since, "demo": demo},
    ).all()
    thresholds = session.execute(select(m.LegalThreshold).where(m.LegalThreshold.verified.is_(True))).scalars().all()

    def cap(mod_key: str, obj: str, on: date) -> m.LegalThreshold | None:
        regime = regime_for(on)
        for t in thresholds:
            if (
                t.regime == regime
                and t.modality == mod_key
                and t.object_type == obj
                and t.valid_from <= on
                and (t.valid_to is None or t.valid_to >= on)
                and t.max_amount is not None
            ):
                return t
        return None

    groups: dict[tuple[Any, ...], list[Any]] = defaultdict(list)
    for r in rows:
        if r.family and r.amount and r.institution_id and r.published_on:
            groups[(r.institution_id, r.family, object_key(r.object_type))].append(r)
    names = dict(session.execute(select(m.UnspscCategory.code, m.UnspscCategory.name)).all())
    found = 0
    order = {"debajo_umbral": 0, "compra_menor": 1}
    for (inst_id, family, obj), procs in groups.items():
        procs.sort(key=lambda r: (r.published_on, r.code))
        i = 0
        while i < len(procs):
            first = procs[i]
            window = int(p["ley_47_25_window_days"] if regime_for(first.published_on) == "ley_47_25" else p["window_days"])
            cluster = [x for x in procs[i:] if (x.published_on - first.published_on).days <= window]
            total = sum((x.amount for x in cluster), Decimal(0))
            top_mod = max((modality_key(x.modality) or "debajo_umbral" for x in cluster), key=lambda k: order.get(k, 0))
            limit = cap(top_mod, obj, first.published_on)
            near = (
                [
                    x
                    for x in cluster
                    if limit.max_amount * Decimal(str(p.get("near_cap_ratio", 0.5))) <= x.amount <= limit.max_amount
                ]
                if limit is not None
                else []
            )
            if (
                len(cluster) >= int(p["min_processes"])
                and limit is not None
                and total > limit.max_amount
                and len(near) >= int(p.get("min_near_cap", 3))
            ):
                found += 1
                fam_name = names.get(family, f"artículos del catálogo {family}")
                last = cluster[-1]
                pub.apply(
                    AlertCandidate(
                        rule_code=R.SPLITTING,
                        rule_version=rule.version,
                        subject_key=f"split:{inst_id}:{family}:{first.code}",
                        publishable=True,
                        title=f"Varias compras pequeñas parecidas en pocos días: {fam_name.lower()}",
                        summary=(
                            f"{first.institution or 'Una institución'} realizó {len(cluster)} compras de «{fam_name}» "
                            f"entre el {T.day(first.published_on)} y el {T.day(last.published_on)}, "
                            f"por un total de {T.money(total)}."
                        ),
                        why_flagged=(
                            f"Cada compra se hizo por una modalidad de menor control, pero juntas suman más que el "
                            f"límite de {T.money(limit.max_amount)} vigente para esa modalidad ({limit.source_name}). "
                            "Dividir una compra para usar procedimientos menos competitivos está prohibido, "
                            "salvo excepciones justificadas."
                        ),
                        possible_explanations=[
                            "Necesidades distintas que surgieron en fechas diferentes y no se podían prever.",
                            "Compras por lotes o etapas autorizadas de forma motivada (Ley 47-25, art. 82).",
                            "Fondos insuficientes en el momento de la primera compra.",
                            "Artículos de la misma familia de catálogo pero de naturaleza distinta.",
                        ],
                        missing_information=[
                            "Plan anual de compras (PACC) de la institución.",
                            "Justificación de cada compra y de su modalidad.",
                        ],
                        limitations=[
                            "La agrupación usa la clase de catálogo UNSPSC (rubro-clase) más frecuente de cada proceso.",
                            "Se usan los umbrales oficiales vigentes en la fecha de la primera compra; las instituciones con "
                            "presupuesto pequeño pueden tener umbrales menores (Ley 47-25, art. 59 párrafo IV), así que este "
                            "análisis es conservador.",
                            "El monto usa lo contratado; si no hay contrato, lo estimado al publicar.",
                        ],
                        metrics={
                            "procesos": len(cluster),
                            "total": total,
                            "umbral_superado": limit.max_amount,
                            "modalidad_referencia": top_mod,
                            "ventana_dias": window,
                            "familia": fam_name,
                            "procesos_cerca_del_limite": len(near),
                            "regimen": regime_for(first.published_on),
                            "currency": "DOP",
                        },
                        evidence_grade="B",
                        amount_involved=total,
                        event_date=first.published_on,
                        process_id=first.id,
                        institution_id=inst_id,
                        official_url=first.official_url,
                        competition_component=60.0,
                        evidence=[
                            *[
                                {
                                    "kind": "registro",
                                    "label": f"Proceso {x.code} ({x.modality})",
                                    "entity": "process",
                                    "entity_id": x.id,
                                    "source_url": x.official_url,
                                    "data": {
                                        "process_code": x.code,
                                        "date": x.published_on.isoformat(),
                                        "amount": str(x.amount),
                                        "title": x.title,
                                    },
                                }
                                for x in cluster
                            ],
                            {
                                "kind": "calculo",
                                "label": "Suma frente al umbral",
                                "data": {
                                    "formula": "suma de montos de los procesos agrupados > monto máximo de la modalidad",
                                    "values": {"suma": str(total), "umbral": str(limit.max_amount)},
                                },
                            },
                            {
                                "kind": "documento",
                                "label": limit.source_name,
                                "source_url": limit.source_url,
                                "data": {"vigencia_desde": limit.valid_from.isoformat()},
                            },
                        ],
                    )
                )
                i += len(cluster)
            else:
                i += 1
    retired = pub.retire_missing(R.SPLITTING)
    return {"alertas": found, "procesos_evaluados": len(rows), "retiradas": retired}


def run_concentration_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    p = rule.params
    rows = session.execute(
        text(
            """
        WITH lines AS (
          SELECT c.institution_id, ci.unspsc_family AS family, c.supplier_id, c.id AS contract_id,
                 extract(year FROM coalesce(c.awarded_at, c.created_at_source))::int AS yr, ci.total
          FROM contract_items ci JOIN contracts c ON c.id = ci.contract_id
          WHERE c.currency = 'DOP' AND c.is_demo = :demo AND coalesce(c.awarded_at, c.created_at_source) >= :since
            AND ci.unspsc_family IS NOT NULL AND c.supplier_id IS NOT NULL AND ci.total > 0
        ), grp AS (
          SELECT institution_id, family, yr, sum(total) AS group_total FROM lines GROUP BY 1, 2, 3
        ), sup AS (
          SELECT institution_id, family, yr, supplier_id, sum(total) AS supplier_total, count(DISTINCT contract_id) AS n_contracts
          FROM lines GROUP BY 1, 2, 3, 4
        ), market AS (
          SELECT family, yr, count(DISTINCT supplier_id) AS n_suppliers FROM lines GROUP BY 1, 2
        )
        SELECT s.*, g.group_total, m.n_suppliers, i.name AS institution, sp.name AS supplier
        FROM sup s JOIN grp g USING (institution_id, family, yr) JOIN market m USING (family, yr)
        LEFT JOIN institutions i ON i.id = s.institution_id LEFT JOIN suppliers sp ON sp.id = s.supplier_id
        WHERE g.group_total >= :min_total AND s.supplier_total / g.group_total >= :min_share
          AND s.n_contracts >= :min_contracts AND m.n_suppliers >= :min_market
        """
        ),
        {
            "demo": demo,
            "since": since,
            "min_total": p["min_group_total_dop"],
            "min_share": p["min_share"],
            "min_contracts": p["min_contracts"],
            "min_market": p["min_suppliers_market"],
        },
    ).all()
    names = dict(session.execute(select(m.UnspscCategory.code, m.UnspscCategory.name)).all())
    for r in rows:
        share = (r.supplier_total / r.group_total * 100).quantize(Decimal("0.1"))
        fam = names.get(r.family, f"familia UNSPSC {r.family}")
        pub.apply(
            AlertCandidate(
                rule_code=R.CONCENTRATION,
                rule_version=rule.version,
                subject_key=f"conc:{r.institution_id}:{r.family}:{r.yr}:{r.supplier_id}",
                publishable=True,
                title=f"Un mismo proveedor concentra las compras de «{T.shorten(fam, 60)}» en una institución",
                summary=(
                    f"En {r.yr}, {r.supplier or 'un proveedor'} recibió {T.pct(share)} de lo contratado por "
                    f"{r.institution or 'la institución'} en «{fam}» ({T.money(r.supplier_total)} de "
                    f"{T.money(r.group_total)}), en {r.n_contracts} contratos."
                ),
                why_flagged=(
                    f"Existen al menos {r.n_suppliers} proveedores que vendieron esta categoría al Estado ese año, "
                    "pero en esta institución casi todo lo contrató uno solo. La concentración puede reducir la "
                    "competencia."
                ),
                possible_explanations=[
                    "Contratos marco o acuerdos de largo plazo adjudicados por licitación.",
                    "Proveedor con representación exclusiva de una marca o tecnología.",
                    "Compatibilidad con equipos ya instalados.",
                ],
                missing_information=[
                    "Modalidades usadas en cada contrato y número de ofertas recibidas.",
                    "Existencia de contratos marco o exclusividades documentadas.",
                ],
                limitations=[
                    "Es un patrón estadístico de concentración; no prueba vínculos ni favoritismo.",
                    "Las categorías UNSPSC agrupan artículos que pueden ser distintos entre sí.",
                ],
                metrics={
                    "anio": r.yr,
                    "participacion_pct": share,
                    "monto_proveedor": r.supplier_total,
                    "monto_categoria": r.group_total,
                    "contratos": r.n_contracts,
                    "proveedores_en_el_mercado": r.n_suppliers,
                    "familia": fam,
                    "currency": "DOP",
                },
                evidence_grade="B",
                amount_involved=r.supplier_total,
                event_date=date(r.yr, 12, 31),
                institution_id=r.institution_id,
                supplier_id=r.supplier_id,
                competition_component=40.0,
                official_url=None,
                evidence=[
                    {
                        "kind": "registro",
                        "label": "Contratos del proveedor con la institución",
                        "entity": "supplier",
                        "entity_id": r.supplier_id,
                        "source_url": "https://datosabiertos.dgcp.gob.do/api-dgcp/v1/contratos",
                        "data": {"institution_id": r.institution_id, "supplier_id": r.supplier_id, "year": r.yr},
                    },
                    {
                        "kind": "calculo",
                        "label": "Participación del proveedor",
                        "data": {
                            "formula": "monto contratado al proveedor / monto contratado en la categoría por la institución",
                            "values": {
                                "proveedor": str(r.supplier_total),
                                "categoria": str(r.group_total),
                                "resultado_pct": str(share),
                            },
                        },
                    },
                ],
            )
        )
    retired = pub.retire_missing(R.CONCENTRATION)
    return {"alertas": len(rows), "retiradas": retired}


def run_amendment_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    """Incrementos documentados: enmiendas OCDS o aumentos del monto contratado observados por nosotros."""
    p = rule.params
    rows = session.execute(
        text(
            """
        WITH observed AS (
          SELECT rv.entity_id AS contract_id,
                 min((rv.changed_fields -> 'amount' ->> 0)::numeric) AS first_amount,
                 max(rv.observed_at) AS observed_at
          FROM record_versions rv
          WHERE rv.entity = 'contract' AND rv.changed_fields ? 'amount'
          GROUP BY rv.entity_id
        ), ocds AS (
          SELECT contract_id, min(amount_before) AS first_amount, max(amended_at) AS observed_at
          FROM contract_amendments WHERE amount_before IS NOT NULL GROUP BY contract_id
        ), base AS (
          SELECT coalesce(o.contract_id, b.contract_id) AS contract_id,
                 coalesce(o.first_amount, b.first_amount) AS first_amount,
                 CASE WHEN o.contract_id IS NOT NULL THEN 'ocds' ELSE 'observado' END AS origin
          FROM ocds o FULL JOIN observed b ON b.contract_id = o.contract_id
        )
        SELECT c.id, c.code, c.process_id, c.institution_id, c.supplier_id, c.description, c.amount, c.official_url,
               c.currency, base.first_amount, base.origin, i.name AS institution,
               (coalesce(c.awarded_at, c.created_at_source) AT TIME ZONE 'America/Santo_Domingo')::date AS awarded_on
        FROM base JOIN contracts c ON c.id = base.contract_id LEFT JOIN institutions i ON i.id = c.institution_id
        WHERE c.is_demo = :demo AND c.currency = 'DOP' AND base.first_amount > 0
          AND c.amount >= base.first_amount * (1 + :pct / 100.0) AND c.amount - base.first_amount >= :min_inc
        """
        ),
        {"demo": demo, "pct": p["min_increase_pct"], "min_inc": p["min_increase_dop"]},
    ).all()
    for r in rows:
        inc = r.amount - r.first_amount
        inc_pct = (r.amount / r.first_amount - 1) * 100
        origin = (
            "enmiendas publicadas en formato OCDS"
            if r.origin == "ocds"
            else "cambios del monto que nuestro sistema observó en sincronizaciones sucesivas"
        )
        pub.apply(
            AlertCandidate(
                rule_code=R.AMENDMENT,
                rule_version=rule.version,
                subject_key=f"contract:{r.id}",
                publishable=True,
                title="El monto de este contrato aumentó después de firmado",
                summary=(
                    f"El contrato {r.code} de {r.institution or 'una institución'} («{T.shorten(r.description, 80)}») "
                    f"pasó de {T.money(r.first_amount)} a {T.money(r.amount)}."
                ),
                why_flagged=f"El aumento es de {T.money(inc)} ({T.pct(inc_pct)}), según {origin}.",
                possible_explanations=[
                    "Ampliación de cantidades o alcance prevista en el contrato.",
                    "Ajuste de precios autorizado (por ejemplo, por inflación en obras).",
                    "Corrección de un error de registro del monto inicial.",
                ],
                missing_information=["Adenda firmada y su justificación.", "Informe técnico que sustente el aumento."],
                limitations=[
                    "Solo se registran cambios desde que nuestro sistema empezó a observar el contrato, o los "
                    "publicados como enmiendas OCDS.",
                    "Las leyes de contrataciones permiten modificaciones dentro de ciertos límites.",
                ],
                metrics={
                    "monto_inicial": r.first_amount,
                    "monto_actual": r.amount,
                    "incremento": inc,
                    "incremento_pct": inc_pct.quantize(Decimal("0.01")),
                    "origen": r.origin,
                    "currency": "DOP",
                },
                evidence_grade="B",
                amount_involved=inc,
                event_date=r.awarded_on,
                process_id=r.process_id,
                contract_id=r.id,
                institution_id=r.institution_id,
                supplier_id=r.supplier_id,
                official_url=r.official_url,
                price_component=float(min(Decimal(100), inc_pct)) * 0.5,
                evidence=[
                    {
                        "kind": "registro",
                        "label": f"Contrato {r.code}",
                        "entity": "contract",
                        "entity_id": r.id,
                        "source_url": r.official_url,
                        "data": {"contract_code": r.code},
                    },
                    {
                        "kind": "calculo",
                        "label": "Incremento contractual",
                        "data": {
                            "formula": "(monto_actual / monto_inicial - 1) * 100",
                            "values": {
                                "monto_inicial": str(r.first_amount),
                                "monto_actual": str(r.amount),
                                "resultado": str(inc_pct.quantize(Decimal("0.01"))),
                            },
                        },
                    },
                ],
            )
        )
    retired = pub.retire_missing(R.AMENDMENT)
    return {"alertas": len(rows), "retiradas": retired}


def run_documents_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    p = rule.params
    comp_mods = R.DEFAULT_RULES[[r["code"] for r in R.DEFAULT_RULES].index(R.COMPETITION)]["params"][
        "competitive_modalities"
    ]
    rows = session.execute(
        text(
            """
        SELECT p.id, p.code, p.title, p.modality, p.institution_id, i.name AS institution, p.official_url,
               p.documents_checked_at,
               (SELECT min(coalesce(c.awarded_at, c.created_at_source)) FROM contracts c WHERE c.process_id = p.id) AS awarded_at,
               (SELECT sum(c.amount) FROM contracts c WHERE c.process_id = p.id AND c.currency = 'DOP') AS contracted,
               (SELECT count(*) FROM source_documents d WHERE d.process_id = p.id) AS n_docs,
               (SELECT string_agg(lower(coalesce(d.doc_type, '') || ' ' || d.name), ' | ') FROM source_documents d
                 WHERE d.process_id = p.id) AS doc_text
        FROM procurement_processes p LEFT JOIN institutions i ON i.id = p.institution_id
        WHERE p.documents_checked_at IS NOT NULL AND p.modality = ANY(:mods) AND p.is_demo = :demo
          AND p.published_at >= :since
        """
        ),
        {"mods": comp_mods, "demo": demo, "since": since},
    ).all()
    evaluated: set[str] = set()
    found = 0
    for r in rows:
        if r.awarded_at is None or r.contracted is None:
            continue
        if (r.documents_checked_at - r.awarded_at).days < int(p["min_days_after_award"]):
            continue
        evaluated.add(f"process:{r.id}")
        text_docs = r.doc_text or ""
        missing = [name for name, kws in p["expected"].items() if not any(k in text_docs for k in kws)]
        if not missing:
            continue
        found += 1
        nice = {"adjudicacion": "acto o acta de adjudicación", "pliego": "pliego de condiciones o especificaciones técnicas"}
        missing_text = " y ".join(nice.get(x, x) for x in missing)
        pub.apply(
            AlertCandidate(
                rule_code=R.DOCUMENTS,
                rule_version=rule.version,
                subject_key=f"process:{r.id}",
                publishable=True,
                title="No encontramos documentos básicos publicados de esta compra",
                summary=(
                    f"El proceso {r.code} de {r.institution or 'una institución'} («{T.shorten(r.title, 90)}») fue "
                    f"contratado por {T.money(r.contracted)}, pero en el portal no aparece: {missing_text}."
                ),
                why_flagged=(
                    "En las modalidades competitivas estos documentos deben publicarse para que cualquiera pueda "
                    "verificar cómo se eligió al proveedor."
                ),
                possible_explanations=[
                    "El documento se publicó con otro nombre o tipo.",
                    "La publicación está pendiente o se hizo en otro sistema.",
                    "Error en la clasificación de documentos del portal.",
                ],
                missing_information=[f"Publicación de: {missing_text}."],
                limitations=[
                    "Se revisan los nombres y tipos de documentos que expone la API de la DGCP, no su contenido.",
                    f"Consulta realizada el {T.day(r.documents_checked_at.date())}; los documentos pueden publicarse después.",
                ],
                metrics={
                    "documentos_publicados": r.n_docs,
                    "faltantes": missing,
                    "monto_contratado": r.contracted,
                    "currency": "DOP",
                },
                evidence_grade="B",
                amount_involved=r.contracted,
                event_date=r.awarded_at.date(),
                process_id=r.id,
                institution_id=r.institution_id,
                official_url=r.official_url,
                documentation_component=100.0,
                evidence=[
                    {
                        "kind": "registro",
                        "label": f"Proceso {r.code}",
                        "entity": "process",
                        "entity_id": r.id,
                        "source_url": r.official_url,
                        "data": {"process_code": r.code},
                    },
                    {
                        "kind": "calculo",
                        "label": "Revisión de documentos publicados",
                        "data": {
                            "formula": "búsqueda de palabras clave en nombre y tipo de cada documento",
                            "values": {"documentos": r.n_docs, "faltantes": ", ".join(missing)},
                        },
                    },
                ],
            )
        )
    retired = pub.retire_missing(R.DOCUMENTS, evaluated)
    return {"alertas": found, "evaluados": len(evaluated), "retiradas": retired}


def run_temporal_rule(
    session: Session, pub: AlertPublisher, rule: m.DetectionRule, demo: bool, since: date
) -> dict[str, Any]:
    p = rule.params
    comp_mods = R.DEFAULT_RULES[[r["code"] for r in R.DEFAULT_RULES].index(R.COMPETITION)]["params"][
        "competitive_modalities"
    ]
    rows = session.execute(
        text(
            """
        WITH monthly AS (
          SELECT c.institution_id, extract(year FROM d)::int AS yr, extract(month FROM d)::int AS mo, sum(c.amount) AS amt
          FROM (SELECT c.*, (coalesce(c.awarded_at, c.created_at_source) AT TIME ZONE 'America/Santo_Domingo') AS d
                FROM contracts c) c
          JOIN procurement_processes p ON p.id = c.process_id
          WHERE c.currency = 'DOP' AND c.is_demo = :demo AND NOT (p.modality = ANY(:mods)) AND c.institution_id IS NOT NULL
          GROUP BY 1, 2, 3
        )
        SELECT institution_id, yr,
               sum(amt) FILTER (WHERE mo = 12) AS dec_amount,
               sum(amt) FILTER (WHERE mo < 12) / 11.0 AS avg_month,
               count(*) FILTER (WHERE mo < 12) AS months_active
        FROM monthly GROUP BY 1, 2
        HAVING count(*) FILTER (WHERE mo = 12) = 1 AND count(*) FILTER (WHERE mo < 12) >= 6
           AND sum(amt) FILTER (WHERE mo = 12) >= :min_amount
           AND sum(amt) FILTER (WHERE mo = 12) >= :ratio * (sum(amt) FILTER (WHERE mo < 12) / 11.0)
        """
        ),
        {"demo": demo, "mods": comp_mods, "min_amount": p["min_amount_dop"], "ratio": p["min_ratio"]},
    ).all()
    names = dict(session.execute(select(m.Institution.id, m.Institution.name)).all())
    today = date.today()
    found = 0
    for r in rows:
        if r.yr >= today.year:  # solo años cerrados
            continue
        found += 1
        ratio = (r.dec_amount / r.avg_month).quantize(Decimal("0.1"))
        pub.apply(
            AlertCandidate(
                rule_code=R.TEMPORAL,
                rule_version=rule.version,
                subject_key=f"temporal:{r.institution_id}:{r.yr}",
                publishable=True,
                title="Mucha contratación no competitiva concentrada en diciembre",
                summary=(
                    f"En diciembre de {r.yr}, {names.get(r.institution_id, 'una institución')} contrató "
                    f"{T.money(r.dec_amount)} por modalidades no competitivas, {ratio} veces su promedio mensual "
                    f"del resto del año ({T.money(r.avg_month.quantize(Decimal('0.01')))})."
                ),
                why_flagged=(
                    "Concentrar compras al cierre del año fiscal puede indicar planificación deficiente o prisa "
                    "por ejecutar fondos, lo que reduce la competencia."
                ),
                possible_explanations=[
                    "Pagos o compras estacionales (por ejemplo, programas navideños).",
                    "Llegada tardía de fondos presupuestarios.",
                    "Compras planificadas para fin de año en el PACC.",
                ],
                missing_information=[
                    "Plan anual de compras (PACC) y su ejecución.",
                    "Calendario de disponibilidad de fondos.",
                ],
                limitations=[
                    "Compara montos por fecha de adjudicación o creación del contrato.",
                    "Incluye solo modalidades no competitivas (debajo del umbral, contratación menor, excepciones).",
                ],
                metrics={
                    "anio": r.yr,
                    "monto_diciembre": r.dec_amount,
                    "promedio_mensual": r.avg_month.quantize(Decimal("0.01")),
                    "veces_promedio": ratio,
                    "currency": "DOP",
                },
                evidence_grade="B",
                amount_involved=r.dec_amount,
                event_date=date(r.yr, 12, 31),
                institution_id=r.institution_id,
                competition_component=50.0,
                official_url="https://datosabiertos.dgcp.gob.do/api-dgcp/v1/contratos",
                evidence=[
                    {
                        "kind": "calculo",
                        "label": "Comparación mensual",
                        "data": {
                            "formula": "monto de diciembre / promedio mensual enero–noviembre",
                            "values": {
                                "diciembre": str(r.dec_amount),
                                "promedio": str(r.avg_month.quantize(Decimal("0.01"))),
                                "resultado": str(ratio),
                            },
                        },
                    },
                    {
                        "kind": "registro",
                        "label": "Contratos de la institución (API DGCP)",
                        "entity": "institution",
                        "entity_id": r.institution_id,
                        "source_url": "https://datosabiertos.dgcp.gob.do/api-dgcp/v1/contratos",
                        "data": {},
                    },
                ],
            )
        )
    retired = pub.retire_missing(R.TEMPORAL)
    return {"alertas": found, "retiradas": retired}


# ---------------------------------------------------------------------- enriquecimiento


def enrich_details(session: Session, budget: int) -> dict[str, int]:
    """Documentos y OCDS para procesos con alertas, contratos de mayor monto e intentos de compra
    grandes que se cancelaron o quedaron desiertos (para enlazar el aviso de enmienda o el acto de
    cancelación). Cuota limitada."""
    if budget <= 0:
        return {"procesos": 0}
    from tirds.http import PoliteClient, SourceUnavailable
    from tirds.runs import sync_run
    from tirds.sources.dgcp.sync import DgcpSync

    since = datetime.now(UTC) - timedelta(days=14)
    procs = (
        session.execute(
            text(
                """
        SELECT p.id FROM procurement_processes p
        WHERE (p.documents_checked_at IS NULL OR p.documents_checked_at < :since)
          AND (p.id IN (SELECT process_id FROM alerts WHERE process_id IS NOT NULL AND status IN ('publicada','interna'))
               OR p.id IN (SELECT c.process_id FROM contracts c WHERE c.process_id IS NOT NULL AND c.currency = 'DOP'
                           AND c.amount >= 5000000)
               OR (p.status ~* '(cancelad|desiert|suspendid|anulad)' AND p.estimated_amount >= 20000000
                   AND p.published_at >= now() - interval '120 days'))
        ORDER BY (p.id IN (SELECT process_id FROM alerts WHERE process_id IS NOT NULL)) DESC,
                 (p.status ~* '(cancelad|desiert|suspendid|anulad)' AND p.estimated_amount >= 20000000) DESC,
                 p.published_at DESC
        LIMIT :n
        """
            ),
            {"since": since, "n": budget},
        )
        .scalars()
        .all()
    )
    done = 0
    with sync_run(session, "dgcp", "dgcp_detalles", {"budget": budget}) as ctx, PoliteClient() as client:
        sync = DgcpSync(session, client, ctx)
        for pid in procs:
            proc = session.get(m.ProcurementProcess, pid)
            if proc is None:
                continue
            try:
                sync.refresh_process_detail(proc, documents=True)
                sync.refresh_ocds(proc)
                done += 1
            except SourceUnavailable as exc:
                ctx.error(f"{proc.code}: {exc}")
            session.commit()
    return {"procesos": done}


# ---------------------------------------------------------------------- orquestación


RULE_RUNNERS = [
    (R.COMPETITION, run_competition_rule),
    (R.STAGE_GAP, run_stage_gap_rule),
    (R.SPLITTING, run_splitting_rule),
    (R.CONCENTRATION, run_concentration_rule),
    (R.TEMPORAL, run_temporal_rule),
]


def analyze(
    session: Session, demo: bool = False, since: date | None = None, detail_budget: int = 0, only: set[str] | None = None
) -> dict[str, Any]:
    since = since or get_settings().sync_since
    started = time.monotonic()
    run = m.DetectionRun(status="running")
    session.add(run)
    session.commit()
    rules = R.active_rules(session)
    run.rule_versions = {code: r.version for code, r in rules.items()}
    pub = AlertPublisher(session, run.id, rules[R.PRIORITY].params, is_demo=demo)
    counts: dict[str, Any] = {}
    errors: list[str] = []

    def guarded(code: str, fn: Any) -> None:
        rule = rules.get(code)
        if rule is None or not rule.active or (only is not None and code not in only):
            return
        try:
            counts[code] = fn(session, pub, rule, demo, since)
            session.commit()
        except Exception as exc:  # una regla no debe detener a las demás
            session.rollback()
            errors.append(f"{code}: {type(exc).__name__}: {exc}")
            log.error("rule_failed", rule=code, error=str(exc))

    if R.PRICE in rules and (only is None or R.PRICE in only) and rules[R.PRICE].active:
        try:
            counts[R.PRICE] = run_price_rule(session, pub, rules[R.PRICE], demo, since, run.id)
            session.commit()
        except Exception as exc:
            session.rollback()
            errors.append(f"precio: {type(exc).__name__}: {exc}")
            log.error("rule_failed", rule="precio", error=str(exc))
    for code, fn in RULE_RUNNERS:
        guarded(code, fn)
    if detail_budget:
        session.commit()
        counts["enriquecimiento"] = enrich_details(session, detail_budget)
    for code, fn in [(R.DOCUMENTS, run_documents_rule), (R.AMENDMENT, run_amendment_rule)]:
        guarded(code, fn)

    run = session.merge(run)
    run.counts = {"reglas": counts, "alertas": pub.stats}
    run.status = "partial" if errors else "success"
    run.error_detail = "\n".join(errors) or None
    run.finished_at = datetime.now(UTC)
    run.duration_ms = int((time.monotonic() - started) * 1000)
    session.commit()
    from tirds.publish.search_index import refresh_search_index

    refresh_search_index(session, (datetime.now(UTC) - timedelta(minutes=5)).isoformat())
    session.commit()
    return {
        "detection_run": run.id,
        "estado": run.status,
        "conteos": run.counts,
        "errores": errors,
        "segundos": round(run.duration_ms / 1000, 1),
    }


def run_analysis(detail_budget: int = 150, demo: bool | None = None) -> dict[str, Any]:
    with advisory_lock("analysis") as locked, session_scope() as session:
        if not locked:
            return {"estado": "omitido", "motivo": "otro análisis en curso"}
        if demo is None:
            setting = session.execute(select(m.SystemSetting.value).where(m.SystemSetting.key == "data_mode")).scalar()
            demo = bool(setting and setting.get("mode") == "demo")
        return analyze(session, demo=demo, detail_budget=detail_budget)
