"""Sincronización de la API de Datos Abiertos de la DGCP.

Estrategia (ver docs/fuentes.md):
- /procesos admite startdate/enddate (fecha de publicación) → ventanas mensuales.
- /contratos, /contratos/articulos, /ofertas, /procesos/articulos NO tienen filtro de fecha;
  vienen aproximadamente de más reciente a más antiguo. Se recorren páginas hasta que
  dos páginas seguidas quedan completamente antes del corte (más un margen).
- Modo incremental: además se detiene tras K páginas seguidas sin novedades.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import structlog
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from tirds.config import Settings, get_settings
from tirds.db import models as m
from tirds.http import PoliteClient, SourceUnavailable
from tirds.runs import RunContext
from tirds.snapshots import SnapshotWriter
from tirds.sources.dgcp import models as dm
from tirds.transform.parse import slugify
from tirds.transform.upsert import Counts, insert_lines, replace_lines, upsert_tracked, with_line_keys

log = structlog.get_logger()
SOURCE = "dgcp"
PAGE_SIZE = 1000


@dataclass
class PageWalk:
    endpoint: str
    date_field: str
    cutoff: datetime
    incremental: bool
    max_pages: int = 5000
    idle_pages_to_stop: int = 3
    old_pages_to_stop: int = 2
    workers: int = 1


class DgcpSync:
    def __init__(self, session: Session, client: PoliteClient, ctx: RunContext, settings: Settings | None = None):
        self.session = session
        self.client = client
        self.ctx = ctx
        self.settings = settings or get_settings()
        self.base = self.settings.dgcp_base_url.rstrip("/")
        self._inst_cache: dict[int, int] = {}
        self._supplier_cache: dict[int, int] = {}
        self._process_cache: dict[str, int] = {}
        self._contract_cache: dict[str, int] = {}
        # Contratos desconocidos que se buscan uno por uno al llegar sus artículos (0 en backfill).
        self.fetch_missing_contracts_per_page = 20

    # ------------------------------------------------------------------ HTTP

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        before = self.client.requests_made
        data = self.client.get_json(f"{self.base}/{path}", params=params)
        self.ctx.requests += self.client.requests_made - before
        if not isinstance(data, dict) or data.get("hasError"):
            raise SourceUnavailable(f"Respuesta con error en {path}: {str(data)[:300]}")
        return data

    def pages(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        start_page: int = 1,
        max_failed_pages: int = 5,
        page_size: int = PAGE_SIZE,
    ) -> Iterator[tuple[int, list[dict[str, Any]], int | None]]:
        """Recorre páginas hasta `pages` (total informado por la API). Una página puede traer
        menos de `limit` registros sin ser la última (verificado), así que no se usa ese criterio.
        Páginas que fallan tras los reintentos se saltan (con error registrado) hasta un máximo."""
        page = start_page
        failed = 0
        while True:
            try:
                data = self._get(path, {**(params or {}), "page": page, "limit": page_size})
            except SourceUnavailable as exc:
                failed += 1
                self.ctx.error(f"{path} página {page} omitida: {exc}")
                if failed >= max_failed_pages:
                    raise
                page += 1
                continue
            failed = 0
            content = (data.get("payload") or {}).get("content") or []
            total_pages = data.get("pages")
            yield page, content, total_pages
            if not content or (total_pages is not None and page >= int(total_pages)):
                return
            page += 1

    def pages_concurrent(
        self, path: str, params: dict[str, Any] | None = None, workers: int = 3, max_failed_pages: int = 5
    ) -> Iterator[tuple[int, list[dict[str, Any]], int | None]]:
        """Igual que `pages`, pero con `workers` páginas en vuelo (el endpoint tarda ~20 s por
        página del lado del servidor). Entrega en orden. El token bucket mantiene el ritmo total."""
        from concurrent.futures import Future, ThreadPoolExecutor

        def fetch(page: int) -> dict[str, Any]:
            return self.client.get_json(f"{self.base}/{path}", params={**(params or {}), "page": page, "limit": PAGE_SIZE})

        first = self._get(path, {**(params or {}), "page": 1, "limit": PAGE_SIZE})
        total = int(first.get("pages") or 1)
        yield 1, (first.get("payload") or {}).get("content") or [], total
        failed = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            inflight: dict[int, Future[dict[str, Any]]] = {}
            next_page = 2
            current = 2
            try:
                while current <= total:
                    while next_page <= total and len(inflight) < workers:
                        inflight[next_page] = pool.submit(fetch, next_page)
                        next_page += 1
                    future = inflight.pop(current)
                    try:
                        data = future.result()
                        self.ctx.requests += 1
                    except SourceUnavailable as exc:
                        failed += 1
                        self.ctx.error(f"{path} página {current} omitida: {exc}")
                        if failed >= max_failed_pages:
                            raise
                        current += 1
                        continue
                    failed = 0
                    content = (data.get("payload") or {}).get("content") or []
                    yield current, content, total
                    if not content:
                        return
                    current += 1
            finally:
                for f in inflight.values():
                    f.cancel()

    # ------------------------------------------------------------------ helpers

    def _validate(self, model: type[dm.DgcpModel], raw: list[dict[str, Any]], counts: Counts) -> list[Any]:
        out = []
        for rec in raw:
            try:
                obj = model.model_validate(rec)
            except ValidationError as exc:
                counts.invalid += 1
                if counts.invalid <= 5:
                    self.ctx.error(f"{model.__name__} inválido: {exc.errors()[:2]} :: {str(rec)[:200]}")
                continue
            counts.unknown_fields.update(f"{model.__name__}.{f}" for f in obj.unknown_fields())
            out.append(obj)
        counts.fetched += len(raw)
        return out

    def institution_id(self, code: int | None, name: str | None) -> int | None:
        if code is None:
            return None
        if code in self._inst_cache:
            return self._inst_cache[code]
        found = self.session.execute(select(m.Institution.id).where(m.Institution.source_key == code)).scalar()
        if found is None:
            # Unidad de compra aún no sincronizada: se crea con lo mínimo conocido.
            row = {
                "source_key": code,
                "name": name or f"Unidad de compra {code}",
                "acronym": None,
                "kind": None,
                "status": None,
                "budget_chapter_code": None,
                "registered_at": None,
                "slug": f"{slugify(name or 'unidad')}-{code}",
            }
            _, ids = upsert_tracked(self.session, m.Institution, "source_key", [row], "institution", self.ctx.run.id)
            found = ids.get(code)
        if found is not None:
            self._inst_cache[code] = found
        return found

    def supplier_id(self, rpe: int | None, name: str | None) -> int | None:
        if rpe is None:
            return None
        if rpe in self._supplier_cache:
            return self._supplier_cache[rpe]
        found = self.session.execute(select(m.Supplier.id).where(m.Supplier.rpe == rpe)).scalar()
        if found is None and name:
            row = _supplier_stub(rpe, name)
            _, ids = upsert_tracked(self.session, m.Supplier, "rpe", [row], "supplier", self.ctx.run.id)
            found = ids.get(rpe)
        if found is not None:
            self._supplier_cache[rpe] = found
        return found

    def process_id(self, code: str | None) -> int | None:
        if not code:
            return None
        if code not in self._process_cache:
            pid = self.session.execute(select(m.ProcurementProcess.id).where(m.ProcurementProcess.code == code)).scalar()
            if pid is None:
                return None
            self._process_cache[code] = pid
        return self._process_cache[code]

    def contract_id(self, code: str) -> int | None:
        if code not in self._contract_cache:
            cid = self.session.execute(select(m.Contract.id).where(m.Contract.code == code)).scalar()
            if cid is None:
                return None
            self._contract_cache[code] = cid
        return self._contract_cache[code]

    def prefetch(
        self,
        *,
        processes: set[str] | None = None,
        contracts: set[str] | None = None,
        suppliers: dict[int, str | None] | None = None,
        institutions: dict[int, str | None] | None = None,
    ) -> None:
        """Resuelve identificadores en lote (una consulta por tipo) y crea esbozos faltantes."""
        if processes:
            need = [c for c in processes if c and c not in self._process_cache]
            if need:
                self._process_cache.update(
                    dict(
                        self.session.execute(
                            select(m.ProcurementProcess.code, m.ProcurementProcess.id).where(
                                m.ProcurementProcess.code.in_(need)
                            )
                        ).all()
                    )
                )
        if contracts:
            need = [c for c in contracts if c and c not in self._contract_cache]
            if need:
                self._contract_cache.update(
                    dict(self.session.execute(select(m.Contract.code, m.Contract.id).where(m.Contract.code.in_(need))).all())
                )
        if institutions:
            need_i = [c for c in institutions if c is not None and c not in self._inst_cache]
            if need_i:
                self._inst_cache.update(
                    dict(
                        self.session.execute(
                            select(m.Institution.source_key, m.Institution.id).where(m.Institution.source_key.in_(need_i))
                        ).all()
                    )
                )
                missing = [c for c in need_i if c not in self._inst_cache]
                if missing:
                    rows = [
                        {
                            "source_key": c,
                            "name": institutions[c] or f"Unidad de compra {c}",
                            "acronym": None,
                            "kind": None,
                            "status": None,
                            "budget_chapter_code": None,
                            "registered_at": None,
                            "slug": f"{slugify(institutions[c] or 'unidad')}-{c}",
                        }
                        for c in missing
                    ]
                    _, ids = upsert_tracked(self.session, m.Institution, "source_key", rows, "institution", self.ctx.run.id)
                    self._inst_cache.update(ids)
        if suppliers:
            need_s = [r for r in suppliers if r is not None and r not in self._supplier_cache]
            if need_s:
                self._supplier_cache.update(
                    dict(self.session.execute(select(m.Supplier.rpe, m.Supplier.id).where(m.Supplier.rpe.in_(need_s))).all())
                )
                missing_s = [r for r in need_s if r not in self._supplier_cache and suppliers[r]]
                if missing_s:
                    rows = [_supplier_stub(r, suppliers[r] or "") for r in missing_s]
                    _, ids = upsert_tracked(self.session, m.Supplier, "rpe", rows, "supplier", self.ctx.run.id)
                    self._supplier_cache.update(ids)

    # ------------------------------------------------------------------ entidades

    def sync_units(self) -> Counts:
        counts = Counts()
        with SnapshotWriter(self.session, self.ctx.run.id, SOURCE, "unidades_compra") as snap:
            for _, raw, _ in self.pages("unidades_compra"):
                snap.write(raw)
                units = self._validate(dm.PurchasingUnit, raw, counts)
                rows = [
                    {
                        "source_key": u.codigo_unidad_compra,
                        "name": u.unidad_compra,
                        "acronym": u.acronimo,
                        "kind": u.tipo,
                        "status": u.estado,
                        "budget_chapter_code": u.codigo_capitulo,
                        "registered_at": u.fecha_registro,
                        "slug": f"{slugify(u.acronimo or u.unidad_compra)}-{u.codigo_unidad_compra}",
                    }
                    for u in units
                ]
                c, ids = upsert_tracked(self.session, m.Institution, "source_key", rows, "institution", self.ctx.run.id)
                self._inst_cache.update(ids)
                counts.add(_without_fetch(c))
        self.ctx.record(counts)
        self.ctx.checkpoint({"step": "units"})
        return counts

    def sync_catalog(self) -> Counts:
        counts = Counts()
        rows: dict[str, dict[str, Any]] = {}
        for _, raw, _ in self.pages("catalogo"):
            for rec in self._validate(dm.CatalogRecord, raw, counts):
                for level, code, name, parent in (
                    ("segmento", rec.segmento, rec.descripcion_segmento, None),
                    ("familia", rec.familia, rec.descripcion_familia, rec.segmento),
                    ("clase", rec.clase, rec.descripcion_clase, rec.familia),
                    ("subclase", rec.subclase, rec.descripcion_subclase, rec.clase),
                ):
                    if code and name:
                        rows[code] = {"code": code[:8], "level": level, "name": name, "parent_code": parent}
        from sqlalchemy.dialects.postgresql import insert

        values = list(rows.values())
        for i in range(0, len(values), 2000):
            stmt = insert(m.UnspscCategory).values(values[i : i + 2000])
            stmt = stmt.on_conflict_do_update(
                index_elements=["code"],
                set_={"name": stmt.excluded.name, "level": stmt.excluded.level, "parent_code": stmt.excluded.parent_code},
            )
            self.session.execute(stmt)
        self.ctx.record(counts)
        self.ctx.checkpoint({"step": "catalog", "categories": len(values)})
        return counts

    def sync_suppliers_full(self) -> Counts:
        """Directorio completo de proveedores (~130 páginas)."""
        counts = Counts()
        with SnapshotWriter(self.session, self.ctx.run.id, SOURCE, "proveedores") as snap:
            # /proveedores responde HTTP 500 con limit >= 500 (verificado); 200 funciona.
            for page, raw, total in self.pages("proveedores", page_size=200):
                snap.write(raw)
                page_counts = Counts()
                recs = self._validate(dm.SupplierRecord, raw, page_counts)
                rows = [_supplier_row(r) for r in recs]
                c, ids = upsert_tracked(self.session, m.Supplier, "rpe", rows, "supplier", self.ctx.run.id)
                self._supplier_cache.update(ids)
                page_counts.add(c)
                counts.add(page_counts)
                self.ctx.record(page_counts)
                self.ctx.checkpoint({"step": "suppliers", "page": page, "pages": total})
        return counts

    def enrich_suppliers(self, limit: int = 300) -> int:
        """Completa proveedores creados como esbozo desde contratos/ofertas (1 solicitud c/u)."""
        stubs = (
            self.session.execute(
                select(m.Supplier.rpe).where(m.Supplier.detail_loaded.is_(False)).order_by(m.Supplier.id).limit(limit)
            )
            .scalars()
            .all()
        )
        done = failures = 0
        counts = Counts()
        for rpe in stubs:
            try:
                data = self._get("proveedores", {"rpe": rpe, "limit": 1})
            except SourceUnavailable as exc:
                failures += 1
                if failures >= 5:
                    self.ctx.error(f"Proveedores: 5 fallos seguidos, se pospone el resto ({exc})")
                    break
                continue
            failures = 0
            raw = (data.get("payload") or {}).get("content") or []
            recs = self._validate(dm.SupplierRecord, raw, counts)
            if recs:
                c, _ = upsert_tracked(self.session, m.Supplier, "rpe", [_supplier_row(recs[0])], "supplier", self.ctx.run.id)
                counts.add(c)
                done += 1
            if done % 50 == 0:
                self.session.commit()
        self.ctx.record(counts)
        self.ctx.checkpoint({"step": "enrich_suppliers", "done": done})
        return done

    def fetch_missing_processes(self, limit: int = 300) -> int:
        """Procesos referidos por contratos/ofertas pero publicados antes de la ventana consultada."""
        codes = (
            self.session.execute(
                select(m.Contract.process_code)
                .where(m.Contract.process_id.is_(None), m.Contract.process_code.is_not(None))
                .group_by(m.Contract.process_code)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        counts = Counts()
        failures = 0
        for code in codes:
            try:
                data = self._get("procesos", {"proceso": code, "limit": 5})
            except SourceUnavailable:
                failures += 1
                if failures >= 5:
                    break
                continue
            failures = 0
            recs = [
                r
                for r in self._validate(dm.Process, (data.get("payload") or {}).get("content") or [], counts)
                if r.codigo_proceso == code
            ]
            if recs:
                self.prefetch(institutions={r.codigo_unidad_compra: r.unidad_compra for r in recs if r.codigo_unidad_compra})
                c, ids = upsert_tracked(
                    self.session,
                    m.ProcurementProcess,
                    "code",
                    [self._process_row(recs[0])],
                    "process",
                    self.ctx.run.id,
                    preserve=PROCESS_PRESERVE,
                )
                self._process_cache.update(ids)
                counts.add(c)
        self.ctx.record(counts)
        self.ctx.checkpoint({"step": "missing_processes", "requested": len(codes)})
        return counts.new

    # ------------------------------------------------------------------ procesos

    def sync_processes(self, start: date, end: date) -> Counts:
        """Procesos publicados en [start, end], en ventanas mensuales."""
        total = Counts()
        with SnapshotWriter(self.session, self.ctx.run.id, SOURCE, "procesos") as snap:
            for w_start, w_end in _month_windows(start, end):
                params = {"startdate": w_start.isoformat(), "enddate": w_end.isoformat()}
                for page, raw, pages in self.pages("procesos", params):
                    snap.write(raw)
                    counts = Counts()
                    recs = self._validate(dm.Process, raw, counts)
                    self.prefetch(
                        institutions={
                            r.codigo_unidad_compra: r.unidad_compra for r in recs if r.codigo_unidad_compra is not None
                        }
                    )
                    rows = [self._process_row(r) for r in recs]
                    c, ids = upsert_tracked(
                        self.session,
                        m.ProcurementProcess,
                        "code",
                        rows,
                        "process",
                        self.ctx.run.id,
                        preserve=PROCESS_PRESERVE,
                    )
                    self._process_cache.update(ids)
                    counts.add(_without_fetch(c))
                    total.add(counts)
                    self.ctx.record(counts)
                    self.ctx.checkpoint({"step": "processes", "window": params, "page": page, "pages": pages})
        return total

    def _process_row(self, r: dm.Process) -> dict[str, Any]:
        return {
            "code": r.codigo_proceso,
            "institution_id": self.institution_id(r.codigo_unidad_compra, r.unidad_compra),
            "institution_source_key": r.codigo_unidad_compra,
            "title": r.titulo,
            # Ahorro de espacio: la DGCP suele repetir el título como descripción.
            "description": r.descripcion if r.descripcion != r.titulo else None,
            "modality": r.modalidad,
            "exception_type": r.tipo_excepcion,
            "status": r.estado_proceso,
            "currency": r.divisa,
            "estimated_amount": r.monto_estimado,
            "published_at": r.fecha_publicacion,
            "amended_at": r.fecha_enmienda,
            "bids_deadline_at": r.fecha_fin_recepcion_ofertas,
            "bids_opening_at": r.fecha_apertura_ofertas,
            "estimated_award_at": r.fecha_estimada_adjudicacion,
            "estimated_signing_at": r.fecha_suscripcion,
            "object_type": r.objeto_proceso,
            "object_subtype": r.subobjeto_proceso,
            "requesting_area": r.area_requiriente,
            "for_mipymes": r.dirigido_mipymes,
            "is_lotified": r.proceso_lotificado,
            "snip_code": r.codigo_snip if r.es_snip else None,
            "planned": r.adquisicion_planeada,
            "contract_duration": r.duracion_contrato,
            "notified_suppliers": r.numero_proveedores_notificados,
            "official_url": _fix_url(r.url),
        }

    # ------------------------------------------------------------------ recorridos sin filtro de fecha

    def walk(self, spec: PageWalk, handle: Callable[[list[dict[str, Any]]], Counts], entity: str) -> Counts:
        total = Counts()
        old_streak = idle_streak = 0
        with SnapshotWriter(self.session, self.ctx.run.id, SOURCE, entity) as snap:
            source = (
                self.pages_concurrent(spec.endpoint, workers=spec.workers) if spec.workers > 1 else self.pages(spec.endpoint)
            )
            for page, raw, pages in source:
                snap.write(raw)
                counts = handle(raw)
                total.add(counts)
                self.ctx.record(counts)
                self.ctx.checkpoint({"step": entity, "page": page, "pages": pages})
                dates = [d for d in (_dt(rec.get(spec.date_field)) for rec in raw) if d is not None]
                newest = max(dates) if dates else None
                old_streak = old_streak + 1 if newest is not None and newest < spec.cutoff else 0
                idle_streak = idle_streak + 1 if counts.new == 0 and counts.changed == 0 else 0
                if old_streak >= spec.old_pages_to_stop:
                    log.info("walk_stop_cutoff", entity=entity, page=page)
                    break
                if spec.incremental and idle_streak >= spec.idle_pages_to_stop:
                    log.info("walk_stop_idle", entity=entity, page=page)
                    break
                if page >= spec.max_pages:
                    self.ctx.error(f"{entity}: se alcanzó el máximo de páginas ({spec.max_pages})")
                    break
        return total

    def handle_contracts(self, raw: list[dict[str, Any]]) -> Counts:
        counts = Counts()
        recs = self._validate(dm.Contract, raw, counts)
        self.prefetch(
            processes={r.codigo_proceso for r in recs if r.codigo_proceso},
            suppliers={r.rpe: r.razon_social for r in recs if r.rpe is not None},
            institutions={r.codigo_unidad_compra: r.unidad_compra for r in recs if r.codigo_unidad_compra is not None},
        )
        rows = []
        for r in recs:
            rows.append(
                {
                    "code": r.codigo_contrato,
                    "process_code": r.codigo_proceso,
                    "process_id": self.process_id(r.codigo_proceso),
                    "institution_id": self.institution_id(r.codigo_unidad_compra, r.unidad_compra),
                    "supplier_id": self.supplier_id(r.rpe, r.razon_social),
                    "supplier_rpe": r.rpe,
                    "supplier_name": r.razon_social,
                    "status": r.estado_contrato,
                    "award_status": r.estado_adjudicacion,
                    "awarded_at": r.fecha_adjudicacion,
                    "created_at_source": r.fecha_creacion_contrato,
                    "currency": r.divisa,
                    "amount": r.valor_contratado,
                    "payment_method": r.metodo_pago,
                    "payment_term": r.plazo_pago_factura,
                    "description": r.descripcion,
                    "official_url": _fix_url(r.url_contrato),
                }
            )
        c, ids = upsert_tracked(
            self.session, m.Contract, "code", rows, "contract", self.ctx.run.id, preserve=CONTRACT_PRESERVE
        )
        self._contract_cache.update(ids)
        counts.add(_without_fetch(c))
        return counts

    def handle_contract_items(self, raw: list[dict[str, Any]]) -> Counts:
        counts = Counts()
        recs = self._validate(dm.ContractItem, raw, counts)
        self.prefetch(contracts={r.codigo_contrato for r in recs})
        rows = []
        missing: set[str] = set()
        for r in recs:
            cid = self.contract_id(r.codigo_contrato)
            if cid is None:
                missing.add(r.codigo_contrato)
                continue
            rows.append(_contract_item_row(cid, r))
        if missing:
            fetched = self.fetch_contracts(sorted(missing)[: self.fetch_missing_contracts_per_page])
            for r in recs:
                if r.codigo_contrato in missing and r.codigo_contrato in fetched:
                    rows.append(_contract_item_row(fetched[r.codigo_contrato], r))
            unresolved = len([r for r in recs if r.codigo_contrato in missing and r.codigo_contrato not in fetched])
            counts.invalid += unresolved
        rows = with_line_keys(rows, "contract_id")
        inserted = insert_lines(self.session, m.ContractItem, "contract_id", rows)
        counts.new += inserted
        counts.unchanged += len(rows) - inserted
        return counts

    def fetch_contracts(self, codes: list[str]) -> dict[str, int]:
        out: dict[str, int] = {}
        for code in codes:
            data = self._get("contratos", {"contrato": code, "limit": 5})
            raw = (data.get("payload") or {}).get("content") or []
            if raw:
                self.handle_contracts(raw)
                cid = self.contract_id(code)
                if cid is not None:
                    out[code] = cid
        return out

    def handle_bids(self, raw: list[dict[str, Any]]) -> Counts:
        counts = Counts()
        recs = self._validate(dm.Bid, raw, counts)
        self.prefetch(
            processes={r.codigo_proceso for r in recs},
            suppliers={r.rpe: r.razon_social for r in recs if r.rpe is not None},
        )
        rows = [
            {
                "source_key": r.id_oferta,
                "process_code": r.codigo_proceso,
                "process_id": self.process_id(r.codigo_proceso),
                "supplier_id": self.supplier_id(r.rpe, r.razon_social),
                "supplier_rpe": r.rpe,
                "supplier_name": r.razon_social,
                "name": None,  # nombre del archivo de la oferta: sin valor público, se omite por espacio
                "amount": r.valor_oferta,
                "status": r.estado_oferta,
                "evaluation_status": r.estado_evaluacion,
                "bid_type": r.tipo_oferta,
                "submitted_at": r.fecha_entrega_oferta or r.fecha_creacion,
                "evaluated_at": r.fecha_evaluacion,
            }
            for r in recs
        ]
        c, _ = upsert_tracked(self.session, m.Bid, "source_key", rows, "bid", self.ctx.run.id)
        counts.add(_without_fetch(c))
        return counts

    def handle_process_items(self, raw: list[dict[str, Any]]) -> Counts:
        counts = Counts()
        recs = self._validate(dm.ProcessItem, raw, counts)
        self.prefetch(processes={r.codigo_proceso for r in recs})
        rows = []
        for r in recs:
            pid = self.process_id(r.codigo_proceso)
            if pid is None:
                counts.invalid += 1
                continue
            rows.append(_process_item_row(pid, r))
        rows = with_line_keys(rows, "process_id")
        inserted = insert_lines(self.session, m.ProcurementItem, "process_id", rows)
        counts.new += inserted
        counts.unchanged += len(rows) - inserted
        return counts

    # ------------------------------------------------------------------ por proceso (bajo demanda)

    def refresh_process_detail(self, process: m.ProcurementProcess, documents: bool = True) -> None:
        """Documentos y artículos de un proceso (1–2 solicitudes)."""
        counts = Counts()
        now = datetime.now(UTC)
        if documents:
            data = self._get("procesos/documentos", {"proceso": process.code})
            raw = (data.get("payload") or {}).get("content") or []
            docs = self._validate(dm.Document, raw, counts)
            from sqlalchemy.dialects.postgresql import insert

            if docs:
                values = [
                    {
                        "process_id": process.id,
                        "name": d.nombre_documento,
                        "doc_type": d.tipo_documento,
                        "uploaded_at": d.fecha_carga_archivo,
                        "url": d.url_documento,
                    }
                    for d in docs
                ]
                stmt = insert(m.SourceDocument).values(values).on_conflict_do_nothing(index_elements=["process_id", "url"])
                self.session.execute(stmt)
            process.documents_checked_at = now
        rows = []
        for _, raw, _ in self.pages("procesos/articulos", {"proceso": process.code}):
            rows.extend(_process_item_row(process.id, r) for r in self._validate(dm.ProcessItem, raw, counts))
        replace_lines(self.session, m.ProcurementItem, "process_id", process.id, with_line_keys(rows, "process_id"))
        process.items_loaded_at = now
        self.ctx.record(counts)

    def refresh_contract_items(self, contract: m.Contract) -> None:
        counts = Counts()
        rows = []
        for _, raw, _ in self.pages("contratos/articulos", {"contrato": contract.code}):
            rows.extend(_contract_item_row(contract.id, r) for r in self._validate(dm.ContractItem, raw, counts))
        replace_lines(self.session, m.ContractItem, "contract_id", contract.id, with_line_keys(rows, "contract_id"))
        contract.items_loaded_at = datetime.now(UTC)
        self.ctx.record(counts)

    def refresh_ocds(self, process: m.ProcurementProcess) -> int:
        """Enmiendas contractuales publicadas en OCDS (1 solicitud)."""
        from tirds.sources.dgcp.ocds import amendments_from_release

        data = self._get("ocds/releases", {"ocid": f"ocds-6550wx-{process.code}"})
        found = amendments_from_release(data)
        n = 0
        from sqlalchemy.dialects.postgresql import insert

        for contract_code, amend in found:
            cid = self.contract_id(contract_code)
            if cid is None:
                continue
            stmt = (
                insert(m.ContractAmendment)
                .values(contract_id=cid, **amend)
                .on_conflict_do_nothing(index_elements=["contract_id", "source_key"])
            )
            n += self.session.execute(stmt).rowcount or 0
        process.ocds_checked_at = datetime.now(UTC)
        return n


# ---------------------------------------------------------------------- mapeos


PROCESS_PRESERVE = frozenset({"items_loaded_at", "documents_checked_at", "ocds_checked_at"})
CONTRACT_PRESERVE = frozenset({"items_loaded_at"})


def _supplier_row(r: dm.SupplierRecord) -> dict[str, Any]:
    juridica = (r.tipo_persona or "").lower().startswith("persona jur")
    return {
        "rpe": r.rpe,
        "name": r.razon_social,
        "document_type": r.tipo_documento,
        # Minimización: el número de documento de personas físicas (cédula) no se guarda.
        "rnc": r.numero_documento if juridica and (r.tipo_documento or "").upper() == "RNC" else None,
        "person_type": r.tipo_persona,
        "legal_form": r.forma_juridica,
        "status": r.estado,
        "is_mipyme": r.es_mipyme,
        "supplies": r.provee,
        "province": r.provincia,
        "municipality": r.municipio,
        "registered_at": r.fecha_registro_rpe,
        "detail_loaded": True,
    }


def _supplier_stub(rpe: int, name: str) -> dict[str, Any]:
    return {
        "rpe": rpe,
        "name": name,
        "document_type": None,
        "rnc": None,
        "person_type": None,
        "legal_form": None,
        "status": None,
        "is_mipyme": None,
        "supplies": None,
        "province": None,
        "municipality": None,
        "registered_at": None,
        "detail_loaded": False,
    }


def _contract_item_row(contract_id: int, r: dm.ContractItem) -> dict[str, Any]:
    return {
        "contract_id": contract_id,
        "unspsc_family": (r.familia or None) and r.familia[:8],
        "unspsc_class": (r.clase or None) and r.clase[:8],
        "unspsc_subclass": (r.subclase or None) and r.subclase[:8],
        "budget_account": r.cuenta_presupuestaria,
        "item_name": r.descripcion_articulo,
        "user_description": r.descripcion_usuario,
        "unit": r.unidad_medida,
        "quantity": r.cantidad,
        "unit_price": r.precio_unitario,
        "itbis": r.itbis,
        "other_taxes": r.otros_impuestos,
        "discounts": r.descuentos,
        "total": r.costo_total,
    }


def _process_item_row(process_id: int, r: dm.ProcessItem) -> dict[str, Any]:
    return {
        "process_id": process_id,
        "unspsc_subclass": (r.subclase_unspsc or None) and r.subclase_unspsc[:8],
        "item_name": r.descripcion_articulo,
        "user_description": r.descripcion_usuario,
        "unit": r.unidad_medida,
        "quantity": r.cantidad,
        "unit_price_estimated": r.precio_unitario_estimado,
        "total_estimated": r.precio_total_estimado,
        "budget_account": r.cuenta_presupuestaria,
    }


def _fix_url(url: str | None) -> str | None:
    if not url:
        return None
    url = url.replace("gob.do//", "gob.do/")
    return url if url.startswith("https://") else None


def _dt(value: Any) -> datetime | None:
    from tirds.transform.parse import to_datetime

    return to_datetime(value)


def _without_fetch(c: Counts) -> Counts:
    return Counts(new=c.new, changed=c.changed, unchanged=c.unchanged, invalid=c.invalid, duplicates=c.duplicates)


def _month_windows(start: date, end: date) -> Iterator[tuple[date, date]]:
    """Ventanas mensuales que se solapan un día: no se sabe si `enddate` es inclusivo,
    y el upsert idempotente hace inocuo el solapamiento."""
    cur = start
    while cur <= end:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        yield cur, min(nxt, end + timedelta(days=1))
        cur = nxt
