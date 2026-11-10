"""Ciclo de vida de alertas con base de datos: publicación, versionado, retiro (casos 9, 10 y 12)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, text

from tirds.analytics.engine import analyze
from tirds.db import models as m
from tirds.transform.upsert import upsert_tracked

D = Decimal


def seed_market(session, subject_price: str = "50000", n_peers: int = 6) -> m.Contract:
    """Mercado FICTICIO: 1 contrato sujeto + n contratos de referencia de instituciones distintas."""
    now = datetime(2025, 6, 1, tzinfo=UTC)
    insts = []
    for i in range(n_peers + 1):
        inst = m.Institution(
            source_key=900000 + i, name=f"Institución Ficticia {i}", slug=f"ficticia-{i}", content_hash="x", is_demo=False
        )
        session.add(inst)
        insts.append(inst)
    session.flush()
    subject = None
    for i, inst in enumerate(insts):
        price = D(subject_price) if i == 0 else D("30000") + i * 100
        proc = m.ProcurementProcess(
            code=f"DEMO-P-{i}",
            institution_id=inst.id,
            title="Compra de laptops",
            modality="Comparación de Precios",
            currency="DOP",
            published_at=now,
            official_url=f"https://comunidad.comprasdominicana.gob.do/demo/p{i}",
            content_hash="x",
        )
        session.add(proc)
        session.flush()
        c = m.Contract(
            code=f"DEMO-C-{i}",
            process_id=proc.id,
            process_code=proc.code,
            institution_id=inst.id,
            currency="DOP",
            amount=price * 100,
            awarded_at=now + timedelta(days=i),
            status="Activo",
            official_url=f"https://comunidad.comprasdominicana.gob.do/demo/c{i}",
            content_hash="x",
        )
        session.add(c)
        session.flush()
        session.add(
            m.ContractItem(
                contract_id=c.id,
                line_hash=f"h{i}",
                unspsc_subclass="43211503",
                item_name="Computadoras portátiles",
                user_description="Computadora portátil core i5 8GB RAM 256GB SSD",
                unit="Unidad",
                quantity=D(100),
                unit_price=price,
                itbis=price * 100 * D("0.18"),
                other_taxes=D(0),
                discounts=D(0),
                total=price * 100 * D("1.18"),
            )
        )
        if i == 0:
            subject = c
    session.commit()
    return subject


def test_price_alert_is_published_with_evidence_and_is_stable(db):
    seed_market(db)
    out = analyze(db, since=datetime(2025, 1, 1).date())
    alert = db.execute(select(m.Alert).where(m.Alert.rule_code == "precio")).scalar_one()
    assert alert.status == "publicada" and alert.public_label in {"revision_prioritaria", "revision_sugerida"}
    assert alert.public_id.startswith("A-2025-")
    kinds = {e.kind for e in db.execute(select(m.AlertEvidence).where(m.AlertEvidence.alert_id == alert.id)).scalars()}
    assert {"registro", "calculo", "referencia"} <= kinds
    assert alert.limitations and alert.possible_explanations and alert.missing_information
    assert out["conteos"]["alertas"]["publicadas"] == 1
    # Reprocesar sin cambios no crea versiones nuevas (reproducible)
    analyze(db, since=datetime(2025, 1, 1).date())
    db.refresh(alert)
    assert alert.current_version == 1 and alert.status == "publicada"


def test_12_retired_after_correction(db):
    subject = seed_market(db)
    analyze(db, since=datetime(2025, 1, 1).date())
    # La fuente corrige el precio del contrato sujeto
    db.execute(
        text(
            "UPDATE contract_items SET unit_price = 30200, itbis = 30200*100*0.18, total = 30200*100*1.18 "
            "WHERE contract_id = :c"
        ),
        {"c": subject.id},
    )
    db.commit()
    analyze(db, since=datetime(2025, 1, 1).date())
    alert = db.execute(select(m.Alert).where(m.Alert.rule_code == "precio")).scalar_one()
    assert alert.status == "retirada" and alert.public_label == "sin_alerta_vigente"
    history = (
        db.execute(
            select(m.AlertStatusHistory).where(m.AlertStatusHistory.alert_id == alert.id).order_by(m.AlertStatusHistory.id)
        )
        .scalars()
        .all()
    )
    assert [h.to_status for h in history] == ["publicada", "retirada"]


def test_9_contract_amendment(db):
    seed_market(db, n_peers=0)
    contract = db.execute(select(m.Contract)).scalar_one()
    # Cambio observado por nuestro sistema entre dos sincronizaciones (+40%)
    row = {
        "code": contract.code,
        "amount": contract.amount * D("1.4"),
        "currency": "DOP",
        "process_id": contract.process_id,
        "process_code": contract.process_code,
        "institution_id": contract.institution_id,
        "status": "Activo",
        "awarded_at": contract.awarded_at,
        "official_url": contract.official_url,
    }
    upsert_tracked(db, m.Contract, "code", [{**row, "amount": contract.amount}], "contract", None)
    upsert_tracked(db, m.Contract, "code", [row], "contract", None)
    db.commit()
    analyze(db, since=datetime(2025, 1, 1).date(), only={"incremento_contractual", "prioridad"})
    alert = db.execute(select(m.Alert).where(m.Alert.rule_code == "incremento_contractual")).scalar_one()
    assert alert.status == "publicada"
    assert D(alert.metrics["incremento_pct"]) == D("40.00")


def test_10_duplicate_alert_subjects_are_merged(db):
    seed_market(db)
    analyze(db, since=datetime(2025, 1, 1).date())
    analyze(db, since=datetime(2025, 1, 1).date())
    n = db.execute(select(m.Alert)).scalars().all()
    assert len([a for a in n if a.rule_code == "precio"]) == 1


def test_insufficient_sample_stays_internal(db):
    seed_market(db, n_peers=3)
    analyze(db, since=datetime(2025, 1, 1).date())
    alerts = db.execute(select(m.Alert).where(m.Alert.rule_code == "precio")).scalars().all()
    assert all(a.status == "interna" for a in alerts)


def test_editorial_status_is_not_overridden(db):
    seed_market(db)
    analyze(db, since=datetime(2025, 1, 1).date())
    alert = db.execute(select(m.Alert).where(m.Alert.rule_code == "precio")).scalar_one()
    alert.status, alert.public_label = "aclarada", "aclarada"
    db.commit()
    analyze(db, since=datetime(2025, 1, 1).date())
    db.refresh(alert)
    assert alert.status == "aclarada"


def test_demo_alerts_are_flagged(db):
    seed_market(db)
    db.execute(text("UPDATE contracts SET is_demo = true"))
    db.commit()
    analyze(db, demo=True, since=datetime(2025, 1, 1).date())
    alerts = db.execute(select(m.Alert)).scalars().all()
    assert alerts and all(a.is_demo for a in alerts)
