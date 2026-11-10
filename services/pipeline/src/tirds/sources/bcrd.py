"""Tasa de cambio de referencia del dólar (BCRD), hoja 'Diaria' del XLSX público."""

from __future__ import annotations

import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

from python_calamine import CalamineWorkbook
from sqlalchemy.dialects.postgresql import insert

from tirds.config import get_settings
from tirds.db.models import ExchangeRate
from tirds.db.session import advisory_lock, session_scope
from tirds.http import PoliteClient
from tirds.runs import sync_run

MONTHS = {
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
}


def parse_rates(path: Path, since: date) -> list[dict[str, Any]]:
    wb = CalamineWorkbook.from_path(str(path))
    rows = wb.get_sheet_by_name("Diaria").to_python()
    out = []
    for r in rows:
        if len(r) < 5 or not isinstance(r[0], (int, float)):
            continue
        try:
            month = MONTHS[str(r[1]).strip().lower()[:3]]
            d = date(int(r[0]), month, int(r[2]))
        except (KeyError, ValueError, TypeError):
            continue
        if d < since:
            continue
        buy = Decimal(str(round(float(r[3]), 4))) if isinstance(r[3], (int, float)) else None
        sell = Decimal(str(round(float(r[4]), 4))) if isinstance(r[4], (int, float)) else None
        if buy is None and sell is None:
            continue
        out.append({"rate_date": d, "currency": "USD", "buy": buy, "sell": sell, "source_code": "bcrd"})
    return out


def run_bcrd(trigger: str = "cron") -> dict[str, Any]:
    settings = get_settings()
    since = date(settings.sync_since.year - 1, 1, 1)
    with advisory_lock("bcrd") as locked, session_scope() as session:
        if not locked:
            return {"estado": "omitido"}
        with sync_run(session, "bcrd", "bcrd_tasas", trigger=trigger) as ctx, PoliteClient(settings) as client:
            response = client.request(settings.bcrd_rates_url)
            ctx.requests += 1
            with tempfile.NamedTemporaryFile(suffix=".xlsx") as tmp:
                tmp.write(response.content)
                tmp.flush()
                rates = parse_rates(Path(tmp.name), since)
            if rates:
                stmt = insert(ExchangeRate).values(rates)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["rate_date", "currency"], set_={"buy": stmt.excluded.buy, "sell": stmt.excluded.sell}
                )
                session.execute(stmt)
            ctx.counts.fetched += len(rates)
            ctx.counts.new += len(rates)
            session.commit()
            return {"tasas": len(rates), "ultima": rates[-1]["rate_date"].isoformat() if rates else None}
