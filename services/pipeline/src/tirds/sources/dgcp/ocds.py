"""Extracción de enmiendas contractuales desde releases OCDS de la DGCP."""

from __future__ import annotations

from typing import Any

from tirds.transform.parse import clean_text, currency_code, to_datetime, to_decimal


def _releases(payload: Any) -> list[dict[str, Any]]:
    body = payload.get("payload", payload) if isinstance(payload, dict) else payload
    if isinstance(body, dict) and "releases" in body:
        return [r for r in body["releases"] if isinstance(r, dict)]
    if isinstance(body, list):
        out: list[dict[str, Any]] = []
        for item in body:
            out.extend(_releases(item) if isinstance(item, dict) and "releases" in item else [item])
        return [r for r in out if isinstance(r, dict)]
    return [body] if isinstance(body, dict) and "ocid" in body else []


def amendments_from_release(payload: Any) -> list[tuple[str, dict[str, Any]]]:
    """Devuelve [(codigo_contrato, fila_enmienda)] solo con enmiendas explícitas en OCDS."""
    out: list[tuple[str, dict[str, Any]]] = []
    for release in _releases(payload):
        for contract in release.get("contracts") or []:
            code = clean_text(contract.get("id"))
            if not code:
                continue
            value = contract.get("value") or {}
            for idx, amend in enumerate(contract.get("amendments") or []):
                if not isinstance(amend, dict):
                    continue
                key = clean_text(amend.get("id")) or f"{code}-{idx}"
                out.append(
                    (
                        code,
                        {
                            "source_key": key,
                            "amended_at": to_datetime(amend.get("date")),
                            "description": clean_text(amend.get("description") or amend.get("rationale")),
                            "amount_before": to_decimal((amend.get("unaffectedValue") or {}).get("amount")),
                            "amount_after": to_decimal((amend.get("value") or value).get("amount"))
                            if amend.get("value")
                            else None,
                            "currency": currency_code((amend.get("value") or value).get("currency")),
                            "source_url": None,
                        },
                    )
                )
    return out
