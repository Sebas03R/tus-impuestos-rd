"""Los 12 casos obligatorios del motor de alertas (§22 del encargo).

Todas las entidades son FICTICIAS ("Institución Ficticia N", contratos DEMO-...).
Los casos que requieren base de datos (9, 10b, 12) están en tests/integration/test_alert_lifecycle.py.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from tirds.analytics.normalize import normalize_item
from tirds.analytics.price import Observation, PriceComparer
from tirds.analytics.rules import DEFAULT_RULES

PARAMS = next(r for r in DEFAULT_RULES if r["code"] == "precio")["params"]
D = Decimal
BASE_DAY = date(2025, 6, 1)


def obs(
    item_id: int,
    price: str,
    *,
    process: int | None = None,
    inst: int | None = None,
    qty: str = "100",
    text: str = "computadora portatil core i5 8gb 256gb",
    subclass: str = "43211503",
    unit: str = "unidad",
    tax: str = "separado",
    flags: frozenset[str] = frozenset(),
    quals: frozenset[str] = frozenset(),
    days: int = 0,
) -> Observation:
    from tirds.analytics.normalize import QUALIFIERS, spec_dimensions
    from tirds.analytics.normalize import flags as detect

    return Observation(
        item_id=item_id,
        contract_id=1000 + item_id,
        contract_code=f"DEMO-{item_id}",
        process_id=process if process is not None else 5000 + item_id,
        institution_id=inst if inst is not None else 100 + item_id,
        institution_name=f"Institución Ficticia {inst if inst is not None else item_id}",
        supplier_id=None,
        subclass=subclass,
        unit_norm=unit,
        quantity=D(qty),
        price_dop=D(price),
        tax_treatment=tax,
        service_flags=flags,
        qualifiers=quals or detect(text, QUALIFIERS),
        dims=spec_dimensions(text),
        text=text,
        observed_on=BASE_DAY + timedelta(days=days),
        description=text,
        official_url="https://comunidad.comprasdominicana.gob.do/demo",
    )


def peers(n: int, price: str = "30000", **kw) -> list[Observation]:
    return [obs(10 + i, str(D(price) + i * 100), **kw) for i in range(n)]


def run(subject: Observation, pool: list[Observation], **override):
    params = {**PARAMS, **override}
    return PriceComparer([subject, *pool], params).compare(subject)


# 1. Diferencia de precio válida
def test_1_valid_price_difference_is_publishable():
    res = run(obs(1, "50000"), peers(6))
    assert res.n_peers == 6 and res.n_institutions == 6
    assert res.reference_price == D("30250.0000")
    assert res.diff_pct is not None and res.diff_pct > 60
    assert res.level == "prioritaria" and res.evidence_grade == "B" and res.publishable
    assert res.diff_total == (res.contracted_price - res.reference_price) * D(100)


# 2. Productos técnicamente diferentes
def test_2_technically_different_products_are_not_compared():
    res = run(
        obs(1, "90000", text="computadora portatil core i7 16gb 1tb"),
        peers(6, text="computadora portatil core i3 4gb 128gb"),
    )
    assert res.n_peers == 0 and res.level == "informacion_insuficiente" and not res.publishable
    # Calificativos distintos (blindado) caen en otro grupo de comparación
    armored = obs(2, "9000000", text="jeepeta blindada 4x4 2025", subclass="25101503")
    normal = [obs(20 + i, "3000000", text="jeepeta 4x4 2025", subclass="25101503") for i in range(6)]
    assert run(armored, normal).n_peers == 0


# 3. Falta de impuestos en una referencia / en el contrato
def test_3_missing_tax_uses_most_favorable_assumption():
    # El contrato no declara ITBIS: se asume que su precio de 35,400 lo incluye (35,400/1.18 = 30,000)
    res = run(obs(1, "35400", tax="sin_impuesto_declarado"), peers(6, price="30000"))
    assert res.contracted_price == D("30000.0000")
    assert res.level == "sin_alerta"
    assert "ITBIS" in res.tax_assumption


# 4. Monedas distintas
def test_4_foreign_currency_converted_with_documented_rate():
    from tirds.analytics.engine import FxTable

    fx = FxTable.__new__(FxTable)
    fx.rates = {"USD": [(date(2025, 5, 30), D("59.50")), (date(2025, 6, 2), D("59.80"))]}
    assert fx.rate("DOP", BASE_DAY) == 1
    assert fx.rate("USD", BASE_DAY) == D("59.50")  # tasa del día hábil anterior
    assert fx.rate("USD", date(2025, 7, 1)) is None  # más de 7 días sin tasa: no se compara
    assert fx.rate("EUR", BASE_DAY) is None
    subject = obs(1, str(D("508.40") * D("59.50")))  # US$508.40 convertidos ≈ RD$30,250
    assert run(subject, peers(6)).level == "sin_alerta"


# 5. Unidades diferentes
def test_5_units_are_normalized_or_excluded():
    lb = normalize_item(
        subclass="50221101",
        item_name="Arroz",
        user_description="arroz selecto",
        unit="Libra",
        quantity=D("100"),
        unit_price=D("45.36"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    kg = normalize_item(
        subclass="50221101",
        item_name="Arroz",
        user_description="arroz selecto",
        unit="Kilogramo",
        quantity=D("45.359237"),
        unit_price=D("100"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert lb.unit_norm == kg.unit_norm == "kg"
    assert abs(lb.unit_price_pretax - kg.unit_price_pretax) < D("0.01")
    box = normalize_item(
        subclass="44121701",
        item_name="Lapicero",
        user_description="lapicero azul",
        unit="Caja",
        quantity=D("10"),
        unit_price=D("300"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert not box.comparable and box.exclusion_reason == "empaque_sin_contenido_declarado"
    box12 = normalize_item(
        subclass="44121701",
        item_name="Lapicero",
        user_description="lapicero azul caja de 12",
        unit="Caja",
        quantity=D("10"),
        unit_price=D("300"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert box12.comparable and box12.unit_norm == "caja_12"
    service = normalize_item(
        subclass="80111600",
        item_name="Consultoría",
        user_description="consultoría",
        unit="Servicio",
        quantity=D("1"),
        unit_price=D("100000"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert not service.comparable


# 6. Compras con distintas cantidades
def test_6_quantities_outside_band_are_not_peers():
    res = run(obs(1, "50000", qty="1"), peers(6, qty="10000"))
    assert res.n_peers == 0
    assert run(obs(1, "50000", qty="10"), peers(6, qty="150")).n_peers == 6  # dentro de la banda ×20


# 7. Muestras insuficientes
def test_7_insufficient_sample_is_never_published():
    res = run(obs(1, "90000"), peers(3))
    assert res.diff_pct is not None and res.diff_pct > 100
    assert res.evidence_grade == "C" and res.level == "informacion_insuficiente" and not res.publishable
    assert any("se requieren" in n for n in res.notes)


# 8. Documentos (registros) contradictorios
def test_8_contradictory_record_is_excluded():
    bad = normalize_item(
        subclass="43211503",
        item_name="Laptop",
        user_description="laptop core i5",
        unit="Unidad",
        quantity=D("10"),
        unit_price=D("30000"),
        itbis=D("54000"),
        other_taxes=D(0),
        discounts=D(0),
        total=D("900000"),
    )  # debería ser 354,000
    assert not bad.comparable and bad.exclusion_reason == "registro_inconsistente"
    ok = normalize_item(
        subclass="43211503",
        item_name="Laptop",
        user_description="laptop core i5",
        unit="Unidad",
        quantity=D("10"),
        unit_price=D("30000"),
        itbis=D("54000"),
        other_taxes=D(0),
        discounts=D(0),
        total=D("354000"),
    )
    assert ok.comparable and ok.unit_price_pretax == D("30000")


# 9. Modificación contractual → ver tests/integration/test_alert_lifecycle.py::test_9_contract_amendment


# 10. Datos duplicados: varias líneas iguales del mismo proceso cuentan una sola vez
def test_10_duplicated_lines_count_once_per_process():
    dup = [obs(10 + i, "30000", process=777, inst=1) for i in range(8)]  # mismo proceso
    res = run(obs(1, "50000"), dup)
    assert res.n_peers == 1 and res.evidence_grade == "C" and not res.publishable


# 11. Falsos positivos: dispersión alta, diferencia pequeña o servicios incluidos distintos
def test_11_false_positive_controls():
    scattered = [obs(10 + i, p) for i, p in enumerate(["5000", "12000", "30000", "60000", "95000", "150000"])]
    res = run(obs(1, "90000"), scattered)
    assert res.evidence_grade == "C" and not res.publishable
    small = run(obs(1, "33000"), peers(6))  # ~9% por encima
    assert small.level == "sin_alerta"
    with_install = obs(
        1, "60000", text="computadora portatil core i5 8gb 256gb con instalacion", flags=frozenset({"instalacion"})
    )
    assert run(with_install, peers(6)).n_peers == 0
    # Diferencia porcentual alta pero monto total pequeño: queda interno
    mice = [obs(10 + i, str(200 + i), qty="2", text="mouse optico usb") for i in range(6)]
    tiny = run(obs(1, "500", qty="2", text="mouse optico usb"), mice)
    assert tiny.level == "interno" and not tiny.publishable


# 12. Retirada tras corrección → ver tests/integration/test_alert_lifecycle.py::test_12_retired_after_correction


def test_window_excludes_old_references():
    old = [obs(10 + i, "30000", days=-400) for i in range(6)]
    assert run(obs(1, "50000"), old).n_peers == 0


def _norm(desc: str, subclass: str = "15101505", unit: str = "Unidad"):
    return normalize_item(
        subclass=subclass,
        item_name="Artículo",
        user_description=desc,
        unit=unit,
        quantity=D("10"),
        unit_price=D("100"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )


def test_real_world_false_positive_guards():
    # Encontrados en datos reales (2026-11): tickets por denominación, kits de laboratorio,
    # descripciones genéricas y medicamentos sin concentración.
    assert _norm("TICKET DE GASOIL DE 10000 VER FICHA TECNICA").exclusion_reason == "valor_nominal_ticket_o_bono"
    assert _norm("Bonos canjeables para colaboradores", "14111608").exclusion_reason == "valor_nominal_ticket_o_bono"
    assert _norm("CONTROL DIMERO ALTO (KIT)", "41116100").exclusion_reason == "contenido_heterogeneo_kit_o_reactivo"
    assert _norm("Omeprazol", "51171900").exclusion_reason == "descripcion_insuficiente"
    assert _norm("Omeprazol capsulas", "51171900").exclusion_reason == "medicamento_sin_concentracion"
    assert _norm("Omeprazol 20 mg capsulas", "51171900").comparable


def test_pack_notation_must_match():
    from tirds.analytics.normalize import spec_dimensions, specs_compatible

    four = spec_dimensions("papel higienico institucional 4/1")
    single = spec_dimensions("papel higienico institucional")
    assert four.get("empaque") == frozenset({"4"})
    assert not specs_compatible(four, single)
    assert specs_compatible(four, spec_dimensions("papel higienico 4/1 doble hoja"))


def test_pack_word_notation():
    from tirds.analytics.normalize import spec_dimensions

    assert spec_dimensions("agua purificada fardo de 24")["empaque"] == frozenset({"24"})
    assert spec_dimensions("galletas pack 12 unidades")["empaque"] == frozenset({"12"})


def test_more_real_world_guards():
    from tirds.analytics.normalize import spec_dimensions, specs_compatible

    crate = normalize_item(
        subclass="50401700",
        item_name="Tomates",
        user_description="huacal de tomates barcelo",
        unit="Kilogramo",
        quantity=D("10"),
        unit_price=D("3000"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert crate.exclusion_reason == "unidad_contradictoria"
    fridge = normalize_item(
        subclass="52141501",
        item_name="Neveras",
        user_description="Neveras ejecutiva",
        unit="Unidad",
        quantity=D("2"),
        unit_price=D("35000"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert fridge.exclusion_reason == "especificacion_insuficiente"
    n95 = spec_dimensions("mascarilla n95")
    assert n95.get("codigo") == frozenset({"n95"})
    assert not specs_compatible(n95, spec_dimensions("mascarilla desechable"))


def test_similarity_rejects_subset_descriptions():
    subject = obs(1, "20", text="mascarilla n95 respirador", subclass="42131713", qty="1000")
    surgical = [obs(10 + i, "1.5", text="mascarilla", subclass="42131713", qty="1000") for i in range(6)]
    assert run(subject, surgical).n_peers == 0


def test_implausible_difference_is_treated_as_possible_record_error():
    res = run(obs(1, "300000"), peers(6))  # ~900 % por encima
    assert res.level == "informacion_insuficiente" and not res.publishable
    assert any("error de registro" in n for n in res.notes)


def test_perishables_use_short_window():
    food = dict(text="ajo selecto importado", subclass="50401700", unit="kg")
    old = [obs(10 + i, "140", days=-150, **food) for i in range(6)]
    assert run(obs(1, "240", **food), old).n_peers == 0
    recent = [obs(20 + i, "140", days=-30, **food) for i in range(6)]
    assert run(obs(1, "240", **food), recent).n_peers == 6


def test_catalog_name_does_not_inflate_similarity():
    garlic = normalize_item(
        subclass="50401700",
        item_name="Verduras frescas",
        user_description="AJO SELECTO",
        unit="Kilogramo",
        quantity=D("10"),
        unit_price=D("240"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    pepper = normalize_item(
        subclass="50401700",
        item_name="Verduras frescas",
        user_description="AJI GUSTOSO",
        unit="Kilogramo",
        quantity=D("10"),
        unit_price=D("140"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )
    assert garlic.text == "ajo selecto" and pepper.text == "aji gustoso"
    from rapidfuzz import fuzz

    assert fuzz.token_sort_ratio(garlic.text, pepper.text) < PARAMS["min_sort_similarity"]


def _item(desc: str, unit: str, subclass: str = "50161500"):
    return normalize_item(
        subclass=subclass,
        item_name="Artículo",
        user_description=desc,
        unit=unit,
        quantity=D("10"),
        unit_price=D("100"),
        itbis=D(0),
        other_taxes=D(0),
        discounts=D(0),
    )


def test_guards_found_with_full_data():
    assert _item("azucar crema 5 lb", "Kilogramo").exclusion_reason == "unidad_contradictoria"
    assert _item("azucar crema 1 kg", "Kilogramo").comparable
    assert _item("juego de neumatico gomas 265/70r17", "Unidad", "25172504").exclusion_reason == "unidad_contradictoria"
    assert _item("pinturas de esmalte", "Unidad", "31211500").exclusion_reason == "especificacion_insuficiente"
    assert _item("pies de tuberia de cobre 7/8", "Unidad", "40171500").exclusion_reason == "unidad_contradictoria"
    tv = _item("televisor 43 pulgadas + base de tv", "Unidad", "52161505")
    assert "accesorios" in tv.service_flags


def test_toner_needs_model_and_misspelled_tickets():
    assert (
        _item("toner de impresion color azul cian", "Unidad", "44103103").exclusion_reason == "especificacion_insuficiente"
    )
    assert _item("toner hp 105a negro w1105a", "Unidad", "44103103").comparable
    assert _item("tikets de combustible", "Litro", "15101505").exclusion_reason == "valor_nominal_ticket_o_bono"
    assert (
        _item("camisetas sublimadas talla m", "Unidad", "53101604").exclusion_reason
        == "contenido_heterogeneo_kit_o_reactivo"
    )
