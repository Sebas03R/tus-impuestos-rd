"""Fuente → descarga → validación → base de datos, con respuestas REALES grabadas de la API DGCP."""

from __future__ import annotations

import copy
import json
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import respx
from sqlalchemy import func, select

from tirds.db import models as m
from tirds.http import PoliteClient
from tirds.runs import sync_run
from tirds.sources.dgcp.sync import DgcpSync, PageWalk

FIX = Path(__file__).parents[1] / "fixtures" / "dgcp"
BASE = "https://datosabiertos.dgcp.gob.do/api-dgcp/v1"


def load(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


def mock_api(overrides: dict[str, dict] | None = None) -> None:
    data = {
        n: load(n) for n in ("unidades_compra", "procesos", "contratos", "contratos_articulos", "ofertas", "proveedores")
    }
    data.update(overrides or {})
    respx.get(f"{BASE}/unidades_compra").mock(return_value=httpx.Response(200, json=data["unidades_compra"]))
    respx.get(f"{BASE}/procesos").mock(return_value=httpx.Response(200, json=data["procesos"]))
    respx.get(f"{BASE}/contratos").mock(return_value=httpx.Response(200, json=data["contratos"]))
    respx.get(f"{BASE}/contratos/articulos").mock(return_value=httpx.Response(200, json=data["contratos_articulos"]))
    respx.get(f"{BASE}/ofertas").mock(return_value=httpx.Response(200, json=data["ofertas"]))
    respx.get(f"{BASE}/proveedores").mock(return_value=httpx.Response(200, json=data["proveedores"]))


def full_sync(session) -> int:
    from tirds.config import Settings

    settings = Settings(REQUESTS_PER_MINUTE=100000, DATABASE_URL="unused")
    cutoff = datetime(2020, 1, 1, tzinfo=UTC)
    with sync_run(session, "dgcp", "test", trigger="test") as ctx, PoliteClient(settings, sleep=lambda s: None) as client:
        sync = DgcpSync(session, client, ctx, settings)
        sync.sync_units()
        sync.sync_suppliers_full()
        sync.sync_processes(date(2025, 3, 3), date(2025, 3, 4))
        sync.walk(PageWalk("contratos", "fecha_creacion_contrato", cutoff, False), sync.handle_contracts, "contratos")
        sync.walk(
            PageWalk("contratos/articulos", "fecha_creacion_contrato", cutoff, False),
            sync.handle_contract_items,
            "articulos",
        )
        sync.walk(PageWalk("ofertas", "fecha_creacion", cutoff, False), sync.handle_bids, "ofertas")
        session.commit()
        return ctx.run.id


def count(session, model) -> int:
    return session.execute(select(func.count()).select_from(model)).scalar_one()


@respx.mock
def test_sync_persists_real_records_with_provenance(db):
    mock_api()
    full_sync(db)
    procs = load("procesos")["payload"]["content"]
    assert count(db, m.ProcurementProcess) == len(procs)
    assert count(db, m.Contract) == len(load("contratos")["payload"]["content"])
    assert count(db, m.ContractItem) > 0 and count(db, m.Bid) > 0
    p = db.execute(select(m.ProcurementProcess).where(m.ProcurementProcess.code == procs[0]["codigo_proceso"])).scalar_one()
    assert p.institution_id is not None and p.first_seen_at is not None and len(p.content_hash) == 32
    # Montos exactos (Decimal) y desconocidos como NULL
    c = db.execute(select(m.Contract).limit(1)).scalar_one()
    assert c.amount is None or c.amount.as_tuple().exponent >= -2
    run = db.execute(select(m.SyncRun)).scalar_one()
    assert run.status == "success" and run.records_new > 0 and run.requests_made > 0
    assert count(db, m.SourceSnapshot) >= 4  # copias de las respuestas originales
    # Privacidad: no se guarda número de documento de personas físicas
    for s in db.execute(select(m.Supplier)).scalars():
        if s.person_type and "sica" in s.person_type.lower():
            assert s.rnc is None


@respx.mock
def test_second_run_is_idempotent(db):
    mock_api()
    full_sync(db)
    before = {t: count(db, t) for t in (m.ProcurementProcess, m.Contract, m.ContractItem, m.Bid, m.Supplier)}
    full_sync(db)
    after = {t: count(db, t) for t in before}
    assert before == after
    runs = db.execute(select(m.SyncRun).order_by(m.SyncRun.id)).scalars().all()
    assert runs[-1].records_new == 0 and runs[-1].records_changed == 0
    assert count(db, m.RecordVersion) == 0


@respx.mock
def test_source_modification_is_versioned(db):
    mock_api()
    full_sync(db)
    changed = load("contratos")
    original = copy.deepcopy(changed["payload"]["content"][0])
    changed["payload"]["content"][0]["valor_contratado"] = float(original["valor_contratado"] or 0) + 1000
    respx.reset()
    mock_api({"contratos": changed})
    full_sync(db)
    versions = db.execute(select(m.RecordVersion).where(m.RecordVersion.entity == "contract")).scalars().all()
    assert len(versions) == 1
    assert "amount" in versions[0].changed_fields and versions[0].previous_hash != versions[0].new_hash
    contract = db.execute(select(m.Contract).where(m.Contract.code == original["codigo_contrato"])).scalar_one()
    assert contract.last_changed_at is not None


@respx.mock
def test_duplicates_in_batch_and_invalid_records(db):
    procs = load("procesos")
    content = procs["payload"]["content"]
    procs["payload"]["content"] = content + [content[0], {"codigo_proceso": None, "titulo": "sin código"}]
    mock_api({"procesos": procs})
    full_sync(db)
    assert count(db, m.ProcurementProcess) == len(content)
    run = db.execute(select(m.SyncRun)).scalar_one()
    assert run.records_invalid == 1
