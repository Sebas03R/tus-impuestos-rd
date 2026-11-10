"""Modelo relacional de Tus Impuestos RD.

Reglas transversales:
- Dinero en NUMERIC (Decimal), nunca float.
- Toda cifra va acompañada de su moneda; el tipo de monto queda implícito en el nombre
  de la columna (estimated_amount, amount = contratado, etc.) y en search_index.amount_type.
- NULL significa "desconocido"; nunca se reemplaza por 0.
- Cada entidad de origen conserva su identificador de origen (source_key/code), hash del
  contenido y fechas: first_seen_at / last_seen_at (nuestro sistema) y fechas oficiales.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

MONEY = Numeric(18, 2)
PRICE = Numeric(20, 4)
QTY = Numeric(18, 4)
PCT = Numeric(9, 4)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSONB, list[Any]: JSONB}


def _now() -> Any:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TrackedMixin:
    """Procedencia: hash del contenido y cuándo lo vio nuestro sistema."""

    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


# --------------------------------------------------------------------------- ingesta


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    publisher: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    docs_url: Mapped[str | None] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)
    # activa | degradada | bloqueada | no_disponible
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="activa")
    status_detail: Mapped[str | None] = mapped_column(Text)
    update_frequency: Mapped[str | None] = mapped_column(Text)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    job: Mapped[str] = mapped_column(String(60), nullable=False)
    # running | success | partial | failed
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default="running")
    started_at: Mapped[datetime] = _now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    requests_made: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    records_fetched: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    records_new: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    records_changed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    records_unchanged: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    records_invalid: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    errors: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    error_detail: Mapped[str | None] = mapped_column(Text)
    params: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    cursor: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    trigger: Mapped[str] = mapped_column(String(20), nullable=False, server_default="cron")

    __table_args__ = (Index("ix_sync_runs_started", "started_at"),)


class SourceSnapshot(Base):
    """Copia comprimida de las respuestas originales (en Storage o disco)."""

    __tablename__ = "source_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sync_run_id: Mapped[int] = mapped_column(ForeignKey("sync_runs.id", ondelete="CASCADE"))
    entity: Mapped[str] = mapped_column(String(40), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = _now()


class RecordVersion(Base):
    """Cambios observados por nuestro sistema (nunca anteriores al primer avistamiento)."""

    __tablename__ = "record_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    entity: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_key: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = _now()
    sync_run_id: Mapped[int | None] = mapped_column(ForeignKey("sync_runs.id", ondelete="SET NULL"))
    previous_hash: Mapped[str | None] = mapped_column(String(64))
    new_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    changed_fields: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    __table_args__ = (Index("ix_record_versions_entity", "entity", "entity_id"),)


# --------------------------------------------------------------------------- entidades


class Institution(TrackedMixin, Base):
    __tablename__ = "institutions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_key: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)  # codigo_unidad_compra
    name: Mapped[str] = mapped_column(Text, nullable=False)
    acronym: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    budget_chapter_code: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)


class InstitutionAlias(Base):
    __tablename__ = "institution_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"))
    alias: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    first_seen_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("institution_id", "alias", "source"),)


class Supplier(TrackedMixin, Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rpe: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    document_type: Mapped[str | None] = mapped_column(Text)
    # Solo se publica el RNC de personas jurídicas (minimización de datos personales).
    rnc: Mapped[str | None] = mapped_column(Text, index=True)
    person_type: Mapped[str | None] = mapped_column(Text)
    legal_form: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    is_mipyme: Mapped[bool | None] = mapped_column(Boolean)
    supplies: Mapped[str | None] = mapped_column(Text)
    province: Mapped[str | None] = mapped_column(Text)
    municipality: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detail_loaded: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class SupplierAlias(Base):
    __tablename__ = "supplier_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"))
    alias: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    first_seen_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("supplier_id", "alias", "source"),)


class UnspscCategory(Base):
    __tablename__ = "unspsc_categories"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False)  # segmento|familia|clase|subclase
    name: Mapped[str] = mapped_column(Text, nullable=False)
    parent_code: Mapped[str | None] = mapped_column(String(8))


# --------------------------------------------------------------------------- compras


class ProcurementProcess(TrackedMixin, Base):
    __tablename__ = "procurement_processes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    institution_id: Mapped[int | None] = mapped_column(ForeignKey("institutions.id"), index=True)
    institution_source_key: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    modality: Mapped[str | None] = mapped_column(Text, index=True)
    exception_type: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text, index=True)
    currency: Mapped[str | None] = mapped_column(String(3))
    estimated_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    amended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bids_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bids_opening_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_award_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_signing_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    object_type: Mapped[str | None] = mapped_column(Text)
    object_subtype: Mapped[str | None] = mapped_column(Text)
    requesting_area: Mapped[str | None] = mapped_column(Text)
    for_mipymes: Mapped[bool | None] = mapped_column(Boolean)
    is_lotified: Mapped[bool | None] = mapped_column(Boolean)
    snip_code: Mapped[str | None] = mapped_column(Text, index=True)
    planned: Mapped[bool | None] = mapped_column(Boolean)
    contract_duration: Mapped[str | None] = mapped_column(Text)
    notified_suppliers: Mapped[int | None] = mapped_column(Integer)
    official_url: Mapped[str | None] = mapped_column(Text)
    items_loaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    documents_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ocds_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProcurementItem(Base):
    """Artículos solicitados en el proceso (precios ESTIMADOS)."""

    __tablename__ = "procurement_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    process_id: Mapped[int] = mapped_column(ForeignKey("procurement_processes.id", ondelete="CASCADE"), index=True)
    line_hash: Mapped[str] = mapped_column(String(32), nullable=False)
    occurrence: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="1")
    unspsc_subclass: Mapped[str | None] = mapped_column(String(8))
    item_name: Mapped[str | None] = mapped_column(Text)
    user_description: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(QTY)
    unit_price_estimated: Mapped[Decimal | None] = mapped_column(PRICE)
    total_estimated: Mapped[Decimal | None] = mapped_column(MONEY)
    budget_account: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("process_id", "line_hash", "occurrence"),)


class Bid(TrackedMixin, Base):
    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)  # id_oferta
    process_id: Mapped[int | None] = mapped_column(ForeignKey("procurement_processes.id"), index=True)
    process_code: Mapped[str] = mapped_column(Text, nullable=False)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"))
    supplier_rpe: Mapped[int | None] = mapped_column(Integer)
    supplier_name: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)
    status: Mapped[str | None] = mapped_column(Text)
    evaluation_status: Mapped[str | None] = mapped_column(Text)
    bid_type: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Contract(TrackedMixin, Base):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    process_id: Mapped[int | None] = mapped_column(ForeignKey("procurement_processes.id"), index=True)
    process_code: Mapped[str | None] = mapped_column(Text, index=True)
    institution_id: Mapped[int | None] = mapped_column(ForeignKey("institutions.id"))
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"))
    supplier_rpe: Mapped[int | None] = mapped_column(Integer)
    supplier_name: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    award_status: Mapped[str | None] = mapped_column(Text)
    awarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at_source: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    currency: Mapped[str | None] = mapped_column(String(3))
    amount: Mapped[Decimal | None] = mapped_column(MONEY)  # monto CONTRATADO
    payment_method: Mapped[str | None] = mapped_column(Text)
    payment_term: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    official_url: Mapped[str | None] = mapped_column(Text)
    items_loaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ContractItem(Base):
    """Artículos contratados. precio_unitario de la DGCP es ANTES de impuestos y descuentos:
    total = cantidad*precio_unitario + itbis + otros_impuestos - descuentos (verificado)."""

    __tablename__ = "contract_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    line_hash: Mapped[str] = mapped_column(String(32), nullable=False)
    occurrence: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="1")
    unspsc_family: Mapped[str | None] = mapped_column(String(8))
    unspsc_class: Mapped[str | None] = mapped_column(String(8))
    unspsc_subclass: Mapped[str | None] = mapped_column(String(8), index=True)
    budget_account: Mapped[str | None] = mapped_column(Text)
    item_name: Mapped[str | None] = mapped_column(Text)
    user_description: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(QTY)
    unit_price: Mapped[Decimal | None] = mapped_column(PRICE)
    itbis: Mapped[Decimal | None] = mapped_column(MONEY)
    other_taxes: Mapped[Decimal | None] = mapped_column(MONEY)
    discounts: Mapped[Decimal | None] = mapped_column(MONEY)
    total: Mapped[Decimal | None] = mapped_column(MONEY)
    first_seen_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("contract_id", "line_hash", "occurrence"),)


class ContractAmendment(Base):
    __tablename__ = "contract_amendments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    source_key: Mapped[str] = mapped_column(Text, nullable=False)
    amended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    description: Mapped[str | None] = mapped_column(Text)
    amount_before: Mapped[Decimal | None] = mapped_column(MONEY)
    amount_after: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str | None] = mapped_column(String(3))
    source_url: Mapped[str | None] = mapped_column(Text)
    first_seen_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("contract_id", "source_key"),)


class Payment(Base):
    """Sin fuente oficial abierta verificada todavía: la tabla existe para cuando la haya."""

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    source_code: Mapped[str] = mapped_column(String(40), nullable=False)
    source_key: Mapped[str] = mapped_column(Text, nullable=False)
    paid_at: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    first_seen_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("source_code", "source_key"),)


class SourceDocument(Base):
    __tablename__ = "source_documents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    process_id: Mapped[int] = mapped_column(ForeignKey("procurement_processes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    doc_type: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    url: Mapped[str] = mapped_column(Text, nullable=False)
    first_seen_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("process_id", "url"),)


# --------------------------------------------------------------------------- fiscal y obras


class BudgetRecord(Base):
    """Registros presupuestarios con su clasificador original. `universe` evita mezclar
    universos estadísticos distintos (nunca se suman entre sí)."""

    __tablename__ = "budget_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    universe: Mapped[str] = mapped_column(String(40), nullable=False)
    row_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period: Mapped[str | None] = mapped_column(Text)
    institution_code: Mapped[str | None] = mapped_column(Text)
    institution_name: Mapped[str | None] = mapped_column(Text)
    expense_type: Mapped[str | None] = mapped_column(Text)
    funding_source: Mapped[str | None] = mapped_column(Text)
    program: Mapped[str | None] = mapped_column(Text)
    project_name: Mapped[str | None] = mapped_column(Text)
    snip_code: Mapped[str | None] = mapped_column(Text, index=True)
    object_code: Mapped[str | None] = mapped_column(Text)
    object_name: Mapped[str | None] = mapped_column(Text)
    function_name: Mapped[str | None] = mapped_column(Text)
    sector: Mapped[str | None] = mapped_column(Text)
    approved: Mapped[Decimal | None] = mapped_column(MONEY)
    current: Mapped[Decimal | None] = mapped_column(MONEY)  # vigente
    accrued: Mapped[Decimal | None] = mapped_column(MONEY)  # devengado / ejecutado
    paid: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="DOP")
    classification: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    source_updated_at: Mapped[date | None] = mapped_column(Date)
    first_seen_at: Mapped[datetime] = _now()
    last_seen_at: Mapped[datetime] = _now()

    __table_args__ = (
        UniqueConstraint("universe", "row_hash"),
        Index("ix_budget_universe_year", "universe", "year"),
    )


class InvestmentProject(TrackedMixin, Base):
    __tablename__ = "investment_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)  # IdProyecto
    snip_code: Mapped[str | None] = mapped_column(Text, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str | None] = mapped_column(Text)
    project_value: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="DOP")
    sector: Mapped[str | None] = mapped_column(Text)
    executing_entity_code: Mapped[str | None] = mapped_column(Text)
    executing_entity: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    physical_progress_pct: Mapped[Decimal | None] = mapped_column(PCT)
    financial_progress_pct: Mapped[Decimal | None] = mapped_column(PCT)
    objective: Mapped[str | None] = mapped_column(Text)
    project_type: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(Text)
    source_cut_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    funding: Mapped[list[Any] | None] = mapped_column(JSONB)


class ProjectLocation(Base):
    __tablename__ = "project_locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("investment_projects.id", ondelete="CASCADE"), index=True)
    region: Mapped[str | None] = mapped_column(Text)
    province_code: Mapped[str | None] = mapped_column(Text)
    province: Mapped[str | None] = mapped_column(Text, index=True)
    municipality_code: Mapped[str | None] = mapped_column(Text)
    municipality: Mapped[str | None] = mapped_column(Text)
    is_national: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    __table_args__ = (UniqueConstraint("project_id", "province_code", "municipality_code"),)


class ProjectProcurementLink(Base):
    """Vínculo verificable proyecto↔proceso/contrato publicado por MapaInversiones o por SNIP."""

    __tablename__ = "project_procurement_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("investment_projects.id", ondelete="CASCADE"), index=True)
    process_code: Mapped[str | None] = mapped_column(Text, index=True)
    contract_code: Mapped[str | None] = mapped_column(Text, index=True)
    link_source: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str | None] = mapped_column(String(3))
    supplier_name: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("project_id", "process_code", "contract_code", "link_source"),)


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    rate_date: Mapped[date] = mapped_column(Date, primary_key=True)
    currency: Mapped[str] = mapped_column(String(3), primary_key=True)
    buy: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    sell: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    source_code: Mapped[str] = mapped_column(String(40), nullable=False)


# --------------------------------------------------------------------------- radar


class DetectionRule(Base):
    __tablename__ = "detection_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    public_description: Mapped[str] = mapped_column(Text, nullable=False)
    technical_description: Mapped[str] = mapped_column(Text, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    publishable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = _now()
    created_by: Mapped[str] = mapped_column(Text, nullable=False, server_default="sistema")
    change_note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("code", "version"),)


class LegalThreshold(Base):
    """Umbrales de modalidades, versionados por vigencia. Solo con fuente citada."""

    __tablename__ = "legal_thresholds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    regime: Mapped[str] = mapped_column(Text, nullable=False)
    modality: Mapped[str] = mapped_column(Text, nullable=False)
    object_type: Mapped[str] = mapped_column(Text, nullable=False)  # bienes_servicios | obras
    min_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    max_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="DOP")
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source_name: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text)


class DetectionRun(Base):
    __tablename__ = "detection_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    started_at: Mapped[datetime] = _now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default="running")
    rule_versions: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    counts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error_detail: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class PriceObservation(Base):
    """Artículo contratado normalizado para comparación de precios."""

    __tablename__ = "price_observations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    contract_item_id: Mapped[int] = mapped_column(ForeignKey("contract_items.id", ondelete="CASCADE"), unique=True)
    contract_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    process_id: Mapped[int | None] = mapped_column(BigInteger)
    institution_id: Mapped[int | None] = mapped_column(Integer)
    supplier_id: Mapped[int | None] = mapped_column(Integer)
    unspsc_subclass: Mapped[str | None] = mapped_column(String(8))
    unit_norm: Mapped[str | None] = mapped_column(Text)
    quantity_norm: Mapped[Decimal | None] = mapped_column(QTY)
    # Precio unitario antes de impuestos y después de descuentos, en DOP por unidad normalizada.
    unit_price_dop: Mapped[Decimal | None] = mapped_column(PRICE)
    tax_treatment: Mapped[str] = mapped_column(String(32), nullable=False)
    currency_original: Mapped[str | None] = mapped_column(String(3))
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    service_flags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    spec_tokens: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    text_norm: Mapped[str | None] = mapped_column(Text)
    observed_on: Mapped[date | None] = mapped_column(Date)
    comparable: Mapped[bool] = mapped_column(Boolean, nullable=False)
    exclusion_reason: Mapped[str | None] = mapped_column(Text)
    computed_at: Mapped[datetime] = _now()

    __table_args__ = (Index("ix_price_obs_group", "unspsc_subclass", "unit_norm", "comparable"),)


class PriceComparison(Base):
    __tablename__ = "price_comparisons"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    detection_run_id: Mapped[int] = mapped_column(ForeignKey("detection_runs.id", ondelete="CASCADE"), index=True)
    observation_id: Mapped[int] = mapped_column(ForeignKey("price_observations.id", ondelete="CASCADE"), index=True)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    reference_price: Mapped[Decimal | None] = mapped_column(PRICE)
    contracted_price: Mapped[Decimal] = mapped_column(PRICE, nullable=False)
    n_peers: Mapped[int] = mapped_column(Integer, nullable=False)
    n_institutions: Mapped[int] = mapped_column(Integer, nullable=False)
    mad: Mapped[Decimal | None] = mapped_column(PRICE)
    iqr: Mapped[Decimal | None] = mapped_column(PRICE)
    dispersion: Mapped[Decimal | None] = mapped_column(Numeric(16, 4))
    diff_unit: Mapped[Decimal | None] = mapped_column(PRICE)
    diff_pct: Mapped[Decimal | None] = mapped_column(Numeric(16, 4))
    diff_total: Mapped[Decimal | None] = mapped_column(MONEY)
    quantity: Mapped[Decimal | None] = mapped_column(QTY)
    level: Mapped[str] = mapped_column(String(24), nullable=False)
    evidence_grade: Mapped[str] = mapped_column(String(1), nullable=False)
    notes: Mapped[list[Any] | None] = mapped_column(JSONB)
    computed_at: Mapped[datetime] = _now()


class PriceComparisonPeer(Base):
    __tablename__ = "price_comparison_peers"

    comparison_id: Mapped[int] = mapped_column(ForeignKey("price_comparisons.id", ondelete="CASCADE"), primary_key=True)
    observation_id: Mapped[int] = mapped_column(ForeignKey("price_observations.id", ondelete="CASCADE"), primary_key=True)
    similarity: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    unit_price_dop: Mapped[Decimal] = mapped_column(PRICE, nullable=False)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    alert_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    rule_code: Mapped[str] = mapped_column(String(40), nullable=False)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    subject_key: Mapped[str] = mapped_column(Text, nullable=False)
    process_id: Mapped[int | None] = mapped_column(ForeignKey("procurement_processes.id"), index=True)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id"), index=True)
    institution_id: Mapped[int | None] = mapped_column(ForeignKey("institutions.id"), index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), index=True)
    # interna | publicada | retirada | aclarada | en_revision
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    # revision_sugerida | revision_prioritaria | informacion_insuficiente | aclarada | sin_alerta_vigente
    public_label: Mapped[str] = mapped_column(String(32), nullable=False)
    priority_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    priority_breakdown: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    evidence_grade: Mapped[str] = mapped_column(String(1), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    why_flagged: Mapped[str] = mapped_column(Text, nullable=False)
    possible_explanations: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    missing_information: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    limitations: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    amount_involved: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="DOP")
    event_date: Mapped[date | None] = mapped_column(Date)
    first_detected_at: Mapped[datetime] = _now()
    last_evaluated_at: Mapped[datetime] = _now()
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    last_detection_run_id: Mapped[int | None] = mapped_column(BigInteger)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    __table_args__ = (
        UniqueConstraint("rule_code", "subject_key"),
        Index("ix_alerts_public", "status", "priority_score"),
    )


class AlertVersion(Base):
    __tablename__ = "alert_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    detection_run_id: Mapped[int | None] = mapped_column(BigInteger)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    change_reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _now()

    __table_args__ = (UniqueConstraint("alert_id", "version"),)


class AlertEvidence(Base):
    __tablename__ = "alert_evidence"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # registro|documento|calculo|referencia
    label: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(BigInteger)
    source_url: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class AlertStatusHistory(Base):
    __tablename__ = "alert_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    from_label: Mapped[str | None] = mapped_column(String(32))
    to_label: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor: Mapped[str] = mapped_column(Text, nullable=False, server_default="sistema")
    changed_at: Mapped[datetime] = _now()


class CorrectionRequest(Base):
    __tablename__ = "correction_requests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = _now()
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_ref: Mapped[str] = mapped_column(Text, nullable=False)
    requester_name: Mapped[str | None] = mapped_column(Text)
    requester_email: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_url: Mapped[str | None] = mapped_column(Text)
    # recibida | en_revision | aceptada | rechazada
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="recibida")
    resolution: Mapped[str | None] = mapped_column(Text)
    handled_by: Mapped[int | None] = mapped_column(Integer)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip_hash: Mapped[str | None] = mapped_column(String(64))


# --------------------------------------------------------------------------- sistema


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # admin|editor|lector
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = _now()
    actor: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip_hash: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (Index("ix_audit_logs_at", "at"),)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = _now()
    updated_by: Mapped[str] = mapped_column(Text, nullable=False, server_default="sistema")


class SearchTerm(Base):
    """Diccionario de palabras de títulos para corregir errores de tipeo (índice trigram)."""

    __tablename__ = "search_terms"

    term: Mapped[str] = mapped_column(Text, primary_key=True)
    freq: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")


class SearchIndex(Base):
    """Índice de búsqueda unificado (tabla `search_entries`). La vista `search_index` agrega
    `tsv` calculado con public.si_tsv(...) e indexado por expresión (ver migración 0003)."""

    __tablename__ = "search_entries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(16), nullable=False)
    entity_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    ref_code: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    institution_id: Mapped[int | None] = mapped_column(Integer)
    institution_name: Mapped[str | None] = mapped_column(Text)
    supplier_id: Mapped[int | None] = mapped_column(Integer)
    supplier_name: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)
    amount_type: Mapped[str | None] = mapped_column(String(16))
    currency: Mapped[str | None] = mapped_column(String(3))
    event_date: Mapped[date | None] = mapped_column(Date)
    year: Mapped[int | None] = mapped_column(SmallInteger)
    modality: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    object_type: Mapped[str | None] = mapped_column(Text)
    unspsc_families: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    province: Mapped[str | None] = mapped_column(Text)
    has_alert: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    has_documents: Mapped[bool | None] = mapped_column(Boolean)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    updated_at: Mapped[datetime] = _now()

    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id"),
        Index("ix_search_type_date", "entity_type", "event_date"),
    )
