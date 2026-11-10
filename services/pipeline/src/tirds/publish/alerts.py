"""Ciclo de vida de las alertas: creación, versionado, publicación automática y retiro.

Una alerta se publica solo si cumple el control de calidad mínimo: proceso identificable,
fuente oficial, regla aplicada, evidencia reproducible, cálculos, fecha y limitaciones.
Si deja de cumplirse el criterio con datos actualizados, se retira (con historial).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tirds.db.models import Alert, AlertEvidence, AlertStatusHistory, AlertVersion
from tirds.transform.parse import content_hash, stable_json

LABELS = {
    "revision_sugerida": "Revisión sugerida",
    "revision_prioritaria": "Revisión prioritaria",
    "informacion_insuficiente": "Información insuficiente",
    "aclarada": "Aclarada",
    "sin_alerta_vigente": "Sin alerta vigente",
}

DISCLAIMER = "Esta alerta indica una situación que merece revisión. No demuestra por sí sola una irregularidad."


@dataclass
class AlertCandidate:
    rule_code: str
    rule_version: int
    subject_key: str
    publishable: bool
    title: str
    summary: str
    why_flagged: str
    possible_explanations: list[str]
    missing_information: list[str]
    limitations: list[str]
    metrics: dict[str, Any]
    evidence_grade: str
    amount_involved: Decimal | None
    event_date: date | None
    process_id: int | None = None
    contract_id: int | None = None
    institution_id: int | None = None
    supplier_id: int | None = None
    official_url: str | None = None
    # Entradas de prioridad 0–100 por componente (None = no aplica)
    price_component: float = 0.0
    competition_component: float = 0.0
    documentation_component: float = 0.0
    # La regla considera el caso de revisión prioritaria (p. ej. diferencia de precio > 60 %).
    priority_hint: bool = False
    evidence: list[dict[str, Any]] = field(default_factory=list)

    def quality_gate(self) -> list[str]:
        """Motivos por los que NO se puede publicar (lista vacía = cumple)."""
        problems = []
        if not (self.process_id or self.contract_id or self.institution_id):
            problems.append("sin identificación verificable del proceso o institución")
        if not self.official_url and not any(e.get("source_url") for e in self.evidence):
            problems.append("sin enlace a fuente oficial")
        if not any(e["kind"] == "calculo" for e in self.evidence):
            problems.append("sin cálculos comprobables")
        if not self.limitations:
            problems.append("sin limitaciones explícitas")
        if self.evidence_grade not in {"A", "B"}:
            problems.append("evidencia insuficiente")
        return problems


def priority(c: AlertCandidate, params: dict[str, Any]) -> tuple[Decimal, dict[str, Any]]:
    w = params["weights"]
    lo, hi = float(params["magnitude_log10_floor"]), float(params["magnitude_log10_ceiling"])
    amount = float(c.amount_involved or 0)
    magnitude = 0.0 if amount <= 0 else max(0.0, min(100.0, (math.log10(amount) - lo) / (hi - lo) * 100))
    parts = {
        "precio": round(min(100.0, max(0.0, c.price_component)), 1),
        "magnitud": round(magnitude, 1),
        "competencia": round(min(100.0, max(0.0, c.competition_component)), 1),
        "documentacion": round(min(100.0, max(0.0, c.documentation_component)), 1),
    }
    total = sum(parts[k] * float(w[k]) for k in parts) / sum(float(v) for v in w.values())
    parts_text = ", ".join(f"{k}: {v:.0f}/100 (peso {w[k]}%)" for k, v in parts.items())
    breakdown: dict[str, Any] = {**parts, "pesos": w, "explicacion": f"Puntaje {total:.0f}/100 = {parts_text}."}
    return Decimal(str(round(total, 2))), breakdown


def _snapshot(c: AlertCandidate) -> dict[str, Any]:
    return {
        "title": c.title,
        "summary": c.summary,
        "why_flagged": c.why_flagged,
        "metrics": c.metrics,
        "evidence_grade": c.evidence_grade,
        "amount_involved": c.amount_involved,
        "publishable": c.publishable,
        "limitations": c.limitations,
        "missing_information": c.missing_information,
        "evidence": [{k: e.get(k) for k in ("kind", "label", "entity_id", "source_url", "data")} for e in c.evidence],
    }


class AlertPublisher:
    def __init__(self, session: Session, detection_run_id: int, priority_params: dict[str, Any], is_demo: bool = False):
        self.session = session
        self.is_demo = is_demo
        self.run_id = detection_run_id
        self.priority_params = priority_params
        self.seen: dict[str, set[str]] = {}
        self.stats = {"nuevas": 0, "actualizadas": 0, "publicadas": 0, "internas": 0, "retiradas": 0, "sin_cambios": 0}

    def apply(self, c: AlertCandidate) -> Alert:
        self.seen.setdefault(c.rule_code, set()).add(c.subject_key)
        problems = c.quality_gate()
        publish = c.publishable and not problems
        if c.publishable and problems:
            c.limitations = [*c.limitations, "No se publicó automáticamente: " + "; ".join(problems) + "."]
        score, breakdown = priority(c, self.priority_params)
        if not publish:
            label = "informacion_insuficiente"
        elif c.priority_hint or score >= Decimal(str(self.priority_params["priority_label_threshold"])):
            label = "revision_prioritaria"
        else:
            label = "revision_sugerida"
        snap = _snapshot(c)
        snap_hash = content_hash(snap)
        now = datetime.now(UTC)

        alert = self.session.execute(
            select(Alert).where(Alert.rule_code == c.rule_code, Alert.subject_key == c.subject_key)
        ).scalar_one_or_none()
        fields = dict(
            alert_type=c.rule_code,
            rule_code=c.rule_code,
            rule_version=c.rule_version,
            subject_key=c.subject_key,
            process_id=c.process_id,
            contract_id=c.contract_id,
            institution_id=c.institution_id,
            supplier_id=c.supplier_id,
            priority_score=score,
            priority_breakdown=breakdown,
            evidence_grade=c.evidence_grade,
            title=c.title,
            summary=c.summary,
            why_flagged=c.why_flagged,
            possible_explanations=c.possible_explanations,
            missing_information=c.missing_information,
            limitations=c.limitations,
            metrics=_jsonable(c.metrics),
            amount_involved=c.amount_involved,
            event_date=c.event_date,
            last_evaluated_at=now,
            last_detection_run_id=self.run_id,
            is_demo=self.is_demo,
        )
        if alert is None:
            alert = Alert(
                public_id="tmp",
                status="publicada" if publish else "interna",
                public_label=label,
                published_at=now if publish else None,
                current_version=1,
                **fields,
            )
            self.session.add(alert)
            self.session.flush()
            alert.public_id = f"A-{(c.event_date or now.date()).year}-{alert.id:06d}"
            self._version(alert, c, snap, "Detección inicial")
            self._history(alert, None, None, alert.status, label, "Detección automática inicial")
            self.stats["nuevas"] += 1
            self.stats["publicadas" if publish else "internas"] += 1
            return alert

        previous = alert.status, alert.public_label
        prev_hash = self.session.execute(
            select(AlertVersion.snapshot).where(
                AlertVersion.alert_id == alert.id, AlertVersion.version == alert.current_version
            )
        ).scalar()
        changed = prev_hash is None or content_hash(prev_hash) != snap_hash
        for k, v in fields.items():
            setattr(alert, k, v)
        # Las decisiones editoriales (en revisión / aclarada por corrección) no se revierten solas.
        if alert.status in {"en_revision", "aclarada"}:
            pass
        elif publish:
            if alert.status != "publicada":
                alert.published_at = alert.published_at or now
            alert.status, alert.public_label = "publicada", label
        else:
            if alert.status == "publicada":
                alert.status, alert.public_label = "retirada", "informacion_insuficiente"
            elif alert.status == "retirada":
                alert.public_label = "informacion_insuficiente"
            else:
                alert.status, alert.public_label = "interna", label
        if changed:
            alert.current_version += 1
            self._version(alert, c, snap, "Datos o cálculo actualizados")
            self.stats["actualizadas"] += 1
        else:
            self.stats["sin_cambios"] += 1
        if (alert.status, alert.public_label) != previous:
            reason = (
                "Publicada: cumple los criterios con los datos actualizados"
                if alert.status == "publicada"
                else "Retirada: con los datos actualizados la evidencia ya no alcanza para publicarla"
            )
            self._history(alert, previous[0], previous[1], alert.status, alert.public_label, reason)
        return alert

    def retire_missing(self, rule_code: str, evaluated_subjects: set[str] | None = None) -> int:
        """Retira alertas publicadas de una regla cuyo sujeto fue evaluado y ya no la dispara.
        evaluated_subjects=None significa que la regla evaluó todo el universo."""
        seen = self.seen.get(rule_code, set())
        alerts = self.session.execute(
            select(Alert).where(Alert.rule_code == rule_code, Alert.status.in_(["publicada", "interna"]))
        ).scalars()
        n = 0
        for alert in alerts:
            if alert.subject_key in seen:
                continue
            if evaluated_subjects is not None and alert.subject_key not in evaluated_subjects:
                continue
            prev = alert.status, alert.public_label
            if alert.status == "publicada":
                alert.status, alert.public_label = "retirada", "sin_alerta_vigente"
                self._history(
                    alert,
                    prev[0],
                    prev[1],
                    alert.status,
                    alert.public_label,
                    "Retirada: con los datos actualizados el criterio ya no se cumple",
                )
                n += 1
            else:
                alert.public_label = "sin_alerta_vigente"
            alert.last_evaluated_at = datetime.now(UTC)
            alert.last_detection_run_id = self.run_id
        self.stats["retiradas"] += n
        return n

    def _version(self, alert: Alert, c: AlertCandidate, snap: dict[str, Any], reason: str) -> None:
        self.session.execute(
            insert(AlertVersion)
            .values(
                alert_id=alert.id,
                version=alert.current_version,
                detection_run_id=self.run_id,
                rule_version=c.rule_version,
                snapshot=_jsonable(snap),
                change_reason=reason,
            )
            .on_conflict_do_nothing(index_elements=["alert_id", "version"])
        )
        rows = [
            {
                "alert_id": alert.id,
                "version": alert.current_version,
                "kind": e["kind"],
                "label": e["label"],
                "entity": e.get("entity"),
                "entity_id": e.get("entity_id"),
                "source_url": e.get("source_url"),
                "data": _jsonable(e.get("data")),
                "position": i,
            }
            for i, e in enumerate(c.evidence)
        ]
        if rows:
            self.session.execute(insert(AlertEvidence), rows)

    def _history(
        self, alert: Alert, from_status: str | None, from_label: str | None, to_status: str, to_label: str, reason: str
    ) -> None:
        self.session.add(
            AlertStatusHistory(
                alert_id=alert.id,
                from_status=from_status,
                to_status=to_status,
                from_label=from_label,
                to_label=to_label,
                reason=reason,
            )
        )


def _jsonable(value: Any) -> Any:
    import json

    return None if value is None else json.loads(stable_json(value))
