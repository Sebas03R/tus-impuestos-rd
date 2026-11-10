from decimal import Decimal

from tirds.sources.ckan_hacienda import _amount, aggregate
from tirds.sources.mapainversiones import pct


def _row(year: str, month: str, chapter: str, inicial: str, vigente: str, devengado: str) -> dict[str, str]:
    return {
        "Cod.Ref Inst Seccion": "1.1.1.1.1",
        "Ref Inst Seccion": "Administración central",
        "Cod.Capítulo": chapter,
        "Capítulo": f"CAPÍTULO {chapter}",
        "Período": year,
        "Mes.Hist.Imputación": month,
        "Pres. Inicial": inicial,
        "Pres. Vigente Aprobado": vigente,
        "Devengado Aprobado": devengado,
    }


def test_hacienda_monthly_rows_are_summed_per_year_and_chapter():
    rows = [
        _row("2025", "Enero", "0101", "1000", "1000", "100"),
        _row("2025", "Febrero", "0101", "0", "50", "200"),
        _row("2025", "Enero", "0102", "1.08121E+11", "0", "0"),
        _row("2024", "Enero", "0101", "900", "900", "850"),
    ]
    out = aggregate(rows, [("Cod.Capítulo", "Capítulo")], "ejecucion_hacienda_institucion")
    by = {(r["year"], r["institution_code"]): r for r in out}
    assert by[(2025, "0101")]["approved"] == Decimal(1000)
    assert by[(2025, "0101")]["current"] == Decimal(1050)
    assert by[(2025, "0101")]["accrued"] == Decimal(300)
    assert by[(2025, "0102")]["classification"]["montos_aproximados_en_fuente"] is True
    assert by[(2024, "0101")]["accrued"] == Decimal(850)
    assert all(r["universe"] == "ejecucion_hacienda_institucion" and r["paid"] is None for r in out)


def test_amount_flags_scientific_notation():
    assert _amount("1.08121E+11") == (Decimal("1.08121E+11"), True)
    assert _amount("2331883124") == (Decimal("2331883124"), False)
    assert _amount("") == (None, False)


def test_progress_outside_range_is_unknown_not_zero():
    assert pct("46.02") == Decimal("46.02")
    assert pct("150") is None
    assert pct("") is None
    assert pct("-3") is None
