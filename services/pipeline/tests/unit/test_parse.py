from datetime import UTC, datetime
from decimal import Decimal

from tirds.transform import parse as p


def test_decimal_never_float_and_unknown_is_none():
    assert p.to_decimal(50.86) == Decimal("50.86")
    assert p.to_decimal("1,234.50") == Decimal("1234.50")
    assert p.to_decimal(None) is None
    assert p.to_decimal("") is None
    assert p.to_decimal("N/A") is None
    assert p.to_decimal("abc") is None
    assert p.to_decimal(True) is None


def test_datetime_with_seven_fraction_digits_and_z():
    dt = p.to_datetime("2026-11-06T22:38:57.0359544Z")
    assert dt == datetime(2026, 11, 6, 22, 38, 57, 35954, tzinfo=UTC)


def test_naive_datetime_assumes_santo_domingo():
    dt = p.to_datetime("2026-11-08 23:01:11.190")
    assert dt is not None and dt.hour == 3 and dt.day == 9  # UTC-4


def test_bool_and_text():
    assert p.to_bool("Si") is True and p.to_bool("No") is False and p.to_bool("x") is None
    assert p.clean_text("  Inversiones\tSavero,  SRL\t") == "Inversiones Savero, SRL"
    assert p.clean_text("N/A") is None


def test_hash_is_stable_across_decimal_scales():
    assert p.content_hash({"a": Decimal("470000")}) == p.content_hash({"a": Decimal("470000.00")})
    assert p.content_hash({"a": Decimal("50.86")}) == p.content_hash({"a": Decimal("50.8600")})


def test_currency_and_slug():
    assert p.currency_code("RD$") == "DOP" and p.currency_code("usd") == "USD" and p.currency_code("") is None
    assert p.slugify("Ministerio de Educación (MINERD)") == "ministerio-de-educacion-minerd"


def test_to_amount_discards_impossible_values():
    assert p.to_amount("1,234.50") == Decimal("1234.50")
    assert p.to_amount("99999999999999") == Decimal("99999999999999")
    assert p.to_amount("1e20") is None
    assert p.to_amount(-(10**15)) is None
    assert p.to_amount(None) is None
