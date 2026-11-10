"""Datos de DEMOSTRACIÓN, completamente ficticios, para desarrollo y pruebas de interfaz.

- Todas las entidades llevan "Ficticia/Ficticio" y "(DEMO)" en el nombre y códigos DEMO-….
- Todas las filas se marcan is_demo = true y system_settings.data_mode = "demo".
- Se niega a ejecutarse con APP_ENV=production (ver cli.seed_demo) y está pensado para la base
  separada `tirds_demo`; nunca alimenta estadísticas reales.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from tirds.db import models as m
from tirds.db.session import session_scope

D = Decimal
URL = "https://comunidad.comprasdominicana.gob.do/"  # portal oficial (los códigos DEMO no existen en él)

INSTITUTIONS = [
    ("Ministerio Ficticio de Educación (DEMO)", "MFE-DEMO"),
    ("Hospital Ficticio Regional (DEMO)", "HFR-DEMO"),
    ("Ayuntamiento Ficticio de Prueba (DEMO)", "AFP-DEMO"),
    ("Instituto Ficticio de Tecnología (DEMO)", "IFT-DEMO"),
    ("Dirección Ficticia de Obras (DEMO)", "DFO-DEMO"),
    ("Consejo Ficticio de Salud (DEMO)", "CFS-DEMO"),
    ("Oficina Ficticia de Estadística (DEMO)", "OFE-DEMO"),
    ("Fondo Ficticio de Desarrollo (DEMO)", "FFD-DEMO"),
]
SUPPLIERS = [
    f"Proveedor Ficticio {n}, SRL (DEMO)"
    for n in ("Alfa", "Beta", "Gamma", "Delta", "Épsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu")
]
PROVINCES = ["Santiago", "Distrito Nacional", "La Vega", "San Cristóbal", "Puerto Plata", "La Altagracia"]


def load_demo() -> str:
    with session_scope() as s:
        s.execute(
            text("""
            TRUNCATE alerts, alert_versions, alert_evidence, alert_status_history, price_comparisons,
                     price_comparison_peers, price_observations, detection_runs, search_entries, search_terms, contract_items,
                     contract_amendments, contracts, bids, procurement_items, source_documents, procurement_processes,
                     suppliers, institutions, investment_projects, project_locations, project_procurement_links,
                     budget_records, record_versions, sync_runs RESTART IDENTITY CASCADE
        """)
        )
        s.merge(m.SystemSetting(key="data_mode", value={"mode": "demo", "nota": "Datos ficticios de demostración"}))
        for code, level, name in (
            ("43000000", "segmento", "Difusión de tecnologías de información y telecomunicaciones"),
            ("43210000", "familia", "Equipo informático y accesorios"),
            ("43211503", "subclase", "Computadores portátiles"),
            ("44120000", "familia", "Suministros de oficina"),
            ("44121700", "clase", "Instrumentos de escritura"),
            ("44121700", "clase", "Instrumentos de escritura"),
            ("44121701", "subclase", "Bolígrafos"),
            ("42190000", "familia", "Productos para instalaciones médicas"),
            ("42192201", "subclase", "Camillas"),
            ("72100000", "familia", "Servicios de mantenimiento y reparaciones de construcciones"),
        ):
            s.merge(m.UnspscCategory(code=code, level=level, name=name))
        now = datetime.now(UTC)
        insts = []
        for i, (name, acr) in enumerate(INSTITUTIONS):
            inst = m.Institution(
                source_key=990000 + i,
                name=name,
                acronym=acr,
                kind="Institución",
                status="ACTIVA",
                slug=f"{acr.lower()}-{990000 + i}",
                content_hash="demo",
                is_demo=True,
            )
            s.add(inst)
            insts.append(inst)
        sups = []
        for i, name in enumerate(SUPPLIERS):
            sup = m.Supplier(
                rpe=990000 + i,
                name=name,
                person_type="Persona Jurídica",
                rnc=f"DEMO{100000 + i}",
                status="Activo",
                is_mipyme=i % 3 == 0,
                province=PROVINCES[i % len(PROVINCES)],
                supplies="Bienes",
                detail_loaded=True,
                content_hash="demo",
                is_demo=True,
            )
            s.add(sup)
            sups.append(sup)
        s.flush()

        counter = {"p": 0, "c": 0}

        def process(
            inst: m.Institution,
            title: str,
            modality: str,
            published: date,
            estimated: str | None,
            obj: str = "Bienes",
            status: str = "Proceso adjudicado y celebrado",
        ) -> m.ProcurementProcess:
            counter["p"] += 1
            p = m.ProcurementProcess(
                code=f"DEMO-{inst.acronym}-{published.year}-{counter['p']:04d}",
                institution_id=inst.id,
                institution_source_key=inst.source_key,
                title=title,
                modality=modality,
                status=status,
                currency="DOP",
                estimated_amount=D(estimated) if estimated else None,
                published_at=datetime(published.year, published.month, published.day, 14, tzinfo=UTC),
                bids_deadline_at=datetime(published.year, published.month, published.day, 14, tzinfo=UTC)
                + timedelta(days=10),
                object_type=obj,
                official_url=URL,
                content_hash="demo",
                is_demo=True,
                documents_checked_at=now,
                items_loaded_at=now,
            )
            s.add(p)
            s.flush()
            return p

        def contract(
            p: m.ProcurementProcess, sup: m.Supplier, items: list[tuple[str, str, str, str, str, bool]], awarded: date
        ) -> m.Contract:
            counter["c"] += 1
            total = D(0)
            lines = []
            for subclass, name, desc, qty, price, taxed in items:
                q, pr = D(qty), D(price)
                itbis = (q * pr * D("0.18")).quantize(D("0.01")) if taxed else D(0)
                line_total = q * pr + itbis
                total += line_total
                lines.append((subclass, name, desc, q, pr, itbis, line_total))
            c = m.Contract(
                code=f"DEMO-C-{counter['c']:05d}",
                process_id=p.id,
                process_code=p.code,
                institution_id=p.institution_id,
                supplier_id=sup.id,
                supplier_rpe=sup.rpe,
                supplier_name=sup.name,
                status="Activo",
                award_status="Confirmada y enviada",
                awarded_at=datetime(awarded.year, awarded.month, awarded.day, 15, tzinfo=UTC),
                created_at_source=datetime(awarded.year, awarded.month, awarded.day, 15, tzinfo=UTC),
                currency="DOP",
                amount=total,
                payment_method="Transferencia",
                description=p.title,
                official_url=URL,
                content_hash="demo",
                is_demo=True,
                items_loaded_at=now,
            )
            s.add(c)
            s.flush()
            for n, (subclass, name, desc, q, pr, itbis, line_total) in enumerate(lines):
                s.add(
                    m.ContractItem(
                        contract_id=c.id,
                        line_hash=f"demo{c.id}-{n}",
                        unspsc_family=subclass[:4] + "0000",
                        unspsc_class=subclass[:6] + "00",
                        unspsc_subclass=subclass,
                        item_name=name,
                        user_description=desc,
                        unit="Unidad",
                        quantity=q,
                        unit_price=pr,
                        itbis=itbis,
                        other_taxes=D(0),
                        discounts=D(0),
                        total=line_total,
                    )
                )
                s.add(
                    m.ProcurementItem(
                        process_id=p.id,
                        line_hash=f"demo{p.id}-{n}",
                        unspsc_subclass=subclass,
                        item_name=name,
                        user_description=desc,
                        unit="Unidad",
                        quantity=q,
                        unit_price_estimated=pr,
                        total_estimated=q * pr,
                    )
                )
            return c

        def bids(p: m.ProcurementProcess, who: list[m.Supplier], base: Decimal) -> None:
            for k, sup in enumerate(who):
                s.add(
                    m.Bid(
                        source_key=f"DEMO-OF-{p.id}-{k}",
                        process_id=p.id,
                        process_code=p.code,
                        supplier_id=sup.id,
                        supplier_rpe=sup.rpe,
                        supplier_name=sup.name,
                        amount=base * (1 + D(k) / 20),
                        status="Cargada",
                        evaluation_status="Evaluada",
                        bid_type="Oferta digital",
                        submitted_at=p.published_at + timedelta(days=5) if p.published_at else None,
                        content_hash="demo",
                        is_demo=True,
                    )
                )

        laptop = (
            "43211503",
            "Computadoras portátiles",
            "Computadora portátil core i5 8GB RAM 256GB SSD pantalla 14 pulgadas",
        )
        # Mercado de referencia de laptops (7 instituciones, precios ~RD$31,000)
        for i in range(7):
            inst = insts[(i + 1) % len(insts)]
            day = date(2025, 3, 3) + timedelta(days=17 * i)
            p = process(
                inst,
                "Adquisición de computadoras portátiles para personal técnico",
                "Comparación de Precios",
                day,
                "3200000",
            )
            bids(p, sups[i % 4 : i % 4 + 3], D("3100000"))
            contract(p, sups[i % 5], [(*laptop, "100", str(30500 + i * 150), True)], day + timedelta(days=20))
            for doc_type, doc_name in (
                ("Pliego de condiciones", "Pliego de condiciones DEMO.pdf"),
                ("Acto de adjudicación", "Acta de adjudicacion DEMO.pdf"),
            ):
                s.add(
                    m.SourceDocument(
                        process_id=p.id,
                        name=doc_name,
                        doc_type=doc_type,
                        uploaded_at=p.published_at,
                        url=f"{URL}?demo-doc={p.id}-{doc_type[:4]}",
                    )
                )
        # Compra con diferencia de precio (+60%)
        p = process(
            insts[0],
            "Adquisición de computadoras portátiles para centros educativos",
            "Comparación de Precios",
            date(2025, 6, 2),
            "3500000",
        )
        bids(p, sups[5:7], D("4900000"))
        contract(p, sups[6], [(*laptop, "100", "49900", True)], date(2025, 6, 25))
        # Competencia limitada: una sola oferta en licitación
        p = process(
            insts[1], "Adquisición de camillas hospitalarias", "Licitación Pública Nacional", date(2025, 4, 7), "8000000"
        )
        bids(p, [sups[8]], D("7950000"))
        contract(
            p,
            sups[8],
            [("42192201", "Camillas", "Camilla hospitalaria de transporte con barandas", "40", "168000", True)],
            date(2025, 5, 12),
        )
        # Posible fraccionamiento: 4 compras bajo umbral en 20 días (suma > RD$248,085.66)
        for k in range(4):
            day = date(2025, 8, 4) + timedelta(days=6 * k)
            p = process(
                insts[2], f"Compra de materiales de oficina lote {k + 1}", "Compras por Debajo del Umbral", day, "160000"
            )
            contract(
                p,
                sups[9],
                [("44121701", "Bolígrafos", "Bolígrafo azul punta media caja de 12", "600", "260", True)],
                day + timedelta(days=3),
            )
        # Diferencia entre etapas: estimado 2M, contratado ~3.1M
        p = process(
            insts[4], "Reparación de techos de escuelas", "Comparación de Precios", date(2025, 2, 10), "2000000", obj="Obras"
        )
        bids(p, sups[2:5], D("3000000"))
        contract(
            p,
            sups[3],
            [("72101500", "Servicios de apoyo para la construcción", "Reparación de techo en zinc", "1", "2650000", True)],
            date(2025, 3, 20),
        )
        # Procesos en curso y sin contrato (estados vacíos / abiertos)
        for k, inst in enumerate(insts[:4]):
            process(
                inst,
                f"Servicio de mantenimiento de vehículos {k + 1}",
                "Contratación Menor",
                date(2026, 10, 20 + k),
                "850000",
                obj="Servicios",
                status="Proceso publicado",
            )

        # Obras ficticias con provincias reales (geografía) y avances ficticios
        for k in range(6):
            pr = m.InvestmentProject(
                source_key=f"DEMO-PRY-{k}",
                snip_code=f"DEMO{k:04d}",
                name=f"Construcción ficticia de escuela básica {k + 1} (DEMO)",
                status="EN EJECUCION" if k % 2 == 0 else "TERMINADO",
                project_value=D(25000000 + k * 5000000),
                sector="Educación",
                executing_entity=insts[4].name,
                start_date=date(2025, 1 + k, 1),
                end_date=date(2026, 1 + k, 28),
                physical_progress_pct=D(20 + k * 12) if k != 3 else None,
                financial_progress_pct=D(15 + k * 10),
                objective="Proyecto ficticio de demostración.",
                project_type="Infraestructura",
                source_name="DEMO",
                content_hash="demo",
                is_demo=True,
            )
            s.add(pr)
            s.flush()
            s.add(
                m.ProjectLocation(
                    project_id=pr.id,
                    region="DEMO",
                    province=PROVINCES[k],
                    province_code=f"D{k}",
                    municipality=PROVINCES[k],
                    municipality_code=f"D{k}M",
                    is_national=False,
                )
            )
        # Presupuesto ficticio (dos universos que NO se suman)
        for year in (2024, 2025):
            for i, inst in enumerate(insts[:5]):
                s.add(
                    m.BudgetRecord(
                        universe="ejecucion_hacienda_institucion",
                        row_hash=f"demo-{year}-{i}",
                        year=year,
                        period="anual",
                        institution_code=f"DEMO{i}",
                        institution_name=inst.name,
                        approved=D(1_000_000_000 * (i + 1)),
                        current=D(1_100_000_000 * (i + 1)),
                        accrued=D(900_000_000 * (i + 1)),
                        currency="DOP",
                        classification={"seccion": "Administración central (DEMO)"},
                    )
                )
                s.add(
                    m.BudgetRecord(
                        universe="inversion_mapainversiones",
                        row_hash=f"demo-inv-{year}-{i}",
                        year=year,
                        institution_code=f"DEMO{i}",
                        institution_name=inst.name,
                        project_name="Proyecto ficticio",
                        approved=D(50_000_000 * (i + 1)),
                        current=D(60_000_000 * (i + 1)),
                        accrued=D(30_000_000 * (i + 1)),
                        currency="DOP",
                        sector="Educación",
                    )
                )
        for code in ("dgcp", "mapainversiones", "hacienda_ckan", "bcrd"):
            s.add(
                m.SyncRun(
                    source_code=code,
                    job=f"demo_{code}",
                    status="success",
                    started_at=now - timedelta(minutes=5),
                    finished_at=now,
                    duration_ms=1000,
                    records_fetched=10,
                    records_new=10,
                    trigger="demo",
                )
            )
        s.execute(
            text(
                "UPDATE data_sources SET last_success_at = now(), last_attempt_at = now() WHERE code <> 'transparencia_fiscal'"
            )
        )
        s.commit()

        from tirds.analytics.engine import analyze

        result: dict[str, Any] = analyze(s, demo=True, since=date(2025, 1, 1))
        from tirds.publish.search_index import refresh_search_index

        refresh_search_index(s, "-infinity")
        s.commit()
        return f"Datos FICTICIOS cargados. Análisis: {result['conteos']['alertas']}"
