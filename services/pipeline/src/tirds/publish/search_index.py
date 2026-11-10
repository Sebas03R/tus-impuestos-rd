"""Reconstrucción incremental del índice de búsqueda unificado (SQL puro)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

PROCESSES = """
INSERT INTO search_entries (entity_type, entity_id, ref_code, title, body, institution_id, institution_name,
  amount, amount_type, currency, event_date, year, modality, status, object_type, unspsc_families,
  has_alert, has_documents, is_demo, updated_at)
SELECT 'proceso', p.id, p.code, coalesce(p.title, p.description, p.code),
  left(concat_ws(' ', nullif(p.description, p.title),
            (SELECT string_agg(DISTINCT coalesce(pi.item_name, ''), ' ') FROM procurement_items pi WHERE pi.process_id = p.id),
            (SELECT string_agg(DISTINCT coalesce(ci.item_name, ''), ' ') FROM contracts c2 JOIN contract_items ci ON ci.contract_id = c2.id
              WHERE c2.process_id = p.id)), 200),
  p.institution_id, i.name, p.estimated_amount, 'estimado', p.currency,
  (p.published_at AT TIME ZONE 'America/Santo_Domingo')::date,
  extract(year FROM p.published_at AT TIME ZONE 'America/Santo_Domingo')::int,
  p.modality, p.status, p.object_type,
  coalesce((SELECT array_agg(DISTINCT left(pi.unspsc_subclass, 4) || '0000') FROM procurement_items pi
            WHERE pi.process_id = p.id AND pi.unspsc_subclass IS NOT NULL), '{}'),
  EXISTS (SELECT 1 FROM alerts a WHERE a.process_id = p.id AND a.status = 'publicada'),
  CASE WHEN p.documents_checked_at IS NULL THEN NULL
       ELSE EXISTS (SELECT 1 FROM source_documents d WHERE d.process_id = p.id) END,
  p.is_demo, now()
FROM procurement_processes p LEFT JOIN institutions i ON i.id = p.institution_id
WHERE p.last_seen_at >= :since OR coalesce(p.last_changed_at, p.first_seen_at) >= :since
   OR p.id IN (SELECT process_id FROM alerts WHERE last_evaluated_at >= :since AND process_id IS NOT NULL)
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  ref_code = EXCLUDED.ref_code, title = EXCLUDED.title, body = EXCLUDED.body,
  institution_id = EXCLUDED.institution_id, institution_name = EXCLUDED.institution_name,
  amount = EXCLUDED.amount, amount_type = EXCLUDED.amount_type, currency = EXCLUDED.currency,
  event_date = EXCLUDED.event_date, year = EXCLUDED.year, modality = EXCLUDED.modality, status = EXCLUDED.status,
  object_type = EXCLUDED.object_type, unspsc_families = EXCLUDED.unspsc_families, has_alert = EXCLUDED.has_alert,
  has_documents = EXCLUDED.has_documents, is_demo = EXCLUDED.is_demo, updated_at = now()
"""

CONTRACTS = """
INSERT INTO search_entries (entity_type, entity_id, ref_code, title, body, institution_id, institution_name,
  supplier_id, supplier_name, amount, amount_type, currency, event_date, year, modality, status, object_type,
  unspsc_families, province, has_alert, is_demo, updated_at)
SELECT 'contrato', c.id, c.code, coalesce(c.description, c.code),
  left(concat_ws(' ', c.process_code, (SELECT string_agg(DISTINCT coalesce(ci.item_name, ''), ' ')
                                  FROM contract_items ci WHERE ci.contract_id = c.id)), 400),
  c.institution_id, i.name, c.supplier_id, coalesce(s.name, c.supplier_name), c.amount, 'contratado', c.currency,
  (coalesce(c.awarded_at, c.created_at_source) AT TIME ZONE 'America/Santo_Domingo')::date,
  extract(year FROM coalesce(c.awarded_at, c.created_at_source) AT TIME ZONE 'America/Santo_Domingo')::int,
  p.modality, c.status, p.object_type,
  coalesce((SELECT array_agg(DISTINCT ci.unspsc_family) FROM contract_items ci
            WHERE ci.contract_id = c.id AND ci.unspsc_family IS NOT NULL), '{}'),
  s.province,
  EXISTS (SELECT 1 FROM alerts a WHERE a.contract_id = c.id AND a.status = 'publicada'),
  c.is_demo, now()
FROM contracts c
LEFT JOIN institutions i ON i.id = c.institution_id
LEFT JOIN suppliers s ON s.id = c.supplier_id
LEFT JOIN procurement_processes p ON p.id = c.process_id
WHERE c.last_seen_at >= :since OR coalesce(c.last_changed_at, c.first_seen_at) >= :since
   OR c.id IN (SELECT contract_id FROM alerts WHERE last_evaluated_at >= :since AND contract_id IS NOT NULL)
ON CONFLICT (entity_type, entity_id) DO UPDATE SET
  ref_code = EXCLUDED.ref_code, title = EXCLUDED.title, body = EXCLUDED.body,
  institution_id = EXCLUDED.institution_id, institution_name = EXCLUDED.institution_name,
  supplier_id = EXCLUDED.supplier_id, supplier_name = EXCLUDED.supplier_name,
  amount = EXCLUDED.amount, amount_type = EXCLUDED.amount_type, currency = EXCLUDED.currency,
  event_date = EXCLUDED.event_date, year = EXCLUDED.year, modality = EXCLUDED.modality, status = EXCLUDED.status,
  object_type = EXCLUDED.object_type, unspsc_families = EXCLUDED.unspsc_families, province = EXCLUDED.province,
  has_alert = EXCLUDED.has_alert, is_demo = EXCLUDED.is_demo, updated_at = now()
"""

INSTITUTIONS = """
INSERT INTO search_entries (entity_type, entity_id, ref_code, title, body, institution_id, institution_name, is_demo, updated_at)
SELECT 'institucion', i.id, i.acronym, i.name, concat_ws(' ', i.acronym, i.kind), i.id, i.name, i.is_demo, now()
FROM institutions i
WHERE i.last_seen_at >= :since OR coalesce(i.last_changed_at, i.first_seen_at) >= :since
ON CONFLICT (entity_type, entity_id) DO UPDATE SET ref_code = EXCLUDED.ref_code, title = EXCLUDED.title,
  body = EXCLUDED.body, institution_name = EXCLUDED.institution_name, updated_at = now()
"""

# Solo proveedores con contratos o con ofertas en la ventana (el directorio completo es grande).
SUPPLIERS = """
INSERT INTO search_entries (entity_type, entity_id, ref_code, title, body, supplier_id, supplier_name, province, is_demo, updated_at)
SELECT 'proveedor', s.id, coalesce(s.rnc, 'RPE ' || s.rpe), s.name, concat_ws(' ', s.supplies, s.legal_form, s.municipality),
  s.id, s.name, s.province, s.is_demo, now()
FROM suppliers s
WHERE (s.last_seen_at >= :since OR coalesce(s.last_changed_at, s.first_seen_at) >= :since)
  AND EXISTS (SELECT 1 FROM contracts c WHERE c.supplier_id = s.id)
ON CONFLICT (entity_type, entity_id) DO UPDATE SET ref_code = EXCLUDED.ref_code, title = EXCLUDED.title,
  body = EXCLUDED.body, supplier_name = EXCLUDED.supplier_name, province = EXCLUDED.province, updated_at = now()
"""

PROJECTS = """
INSERT INTO search_entries (entity_type, entity_id, ref_code, title, body, institution_name, amount, amount_type,
  currency, event_date, year, status, province, is_demo, updated_at)
SELECT 'obra', pr.id, 'SNIP ' || pr.snip_code, pr.name, left(concat_ws(' ', pr.sector, pr.project_type, pr.objective), 200),
  pr.executing_entity, pr.project_value, 'presupuesto', pr.currency, pr.start_date, extract(year FROM pr.start_date)::int,
  pr.status,
  (SELECT string_agg(DISTINCT l.province, ', ') FROM project_locations l WHERE l.project_id = pr.id AND NOT l.is_national),
  pr.is_demo, now()
FROM investment_projects pr
WHERE pr.last_seen_at >= :since OR coalesce(pr.last_changed_at, pr.first_seen_at) >= :since
ON CONFLICT (entity_type, entity_id) DO UPDATE SET ref_code = EXCLUDED.ref_code, title = EXCLUDED.title,
  body = EXCLUDED.body, institution_name = EXCLUDED.institution_name, amount = EXCLUDED.amount,
  event_date = EXCLUDED.event_date, year = EXCLUDED.year, status = EXCLUDED.status, province = EXCLUDED.province,
  updated_at = now()
"""


def refresh_search_index(session: Session, since: str = "-infinity") -> dict[str, int]:
    counts = {}
    for name, sql in (
        ("institucion", INSTITUTIONS),
        ("proveedor", SUPPLIERS),
        ("proceso", PROCESSES),
        ("obra", PROJECTS),
    ):
        counts[name] = session.execute(text(sql), {"since": since}).rowcount or 0
    # Diccionario de palabras para tolerar errores de tipeo (compacto: solo palabras de 4+ letras).
    session.execute(
        text(
            """
        INSERT INTO search_terms (term, freq)
        SELECT w, count(*) FROM (
          SELECT regexp_split_to_table(lower(public.f_unaccent(title || ' ' || coalesce(institution_name, ''))), '[^a-z0-9]+') AS w
          FROM search_entries
        ) t WHERE length(w) >= 4 AND w !~ '^[0-9]+$' GROUP BY w
        ON CONFLICT (term) DO UPDATE SET freq = EXCLUDED.freq
        """
        )
    )
    # Elimina entradas cuyo registro ya no existe.
    session.execute(
        text(
            """
            DELETE FROM search_entries si WHERE
              (si.entity_type = 'proceso' AND NOT EXISTS (SELECT 1 FROM procurement_processes x WHERE x.id = si.entity_id)) OR
              (si.entity_type = 'contrato' AND NOT EXISTS (SELECT 1 FROM contracts x WHERE x.id = si.entity_id)) OR
              (si.entity_type = 'obra' AND NOT EXISTS (SELECT 1 FROM investment_projects x WHERE x.id = si.entity_id))
            """
        )
    )
    return counts
