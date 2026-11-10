import "server-only";
import { cacheLife } from "next/cache";
import { getSql } from "@/lib/db";
import { getDataMode } from "@/lib/queries/system";

export type ProcessRow = {
  id: string;
  code: string;
  title: string | null;
  description: string | null;
  modality: string | null;
  exception_type: string | null;
  status: string | null;
  currency: string | null;
  estimated_amount: string | null;
  published_at: Date | null;
  amended_at: Date | null;
  bids_deadline_at: Date | null;
  bids_opening_at: Date | null;
  estimated_award_at: Date | null;
  estimated_signing_at: Date | null;
  object_type: string | null;
  object_subtype: string | null;
  requesting_area: string | null;
  for_mipymes: boolean | null;
  is_lotified: boolean | null;
  snip_code: string | null;
  planned: boolean | null;
  contract_duration: string | null;
  notified_suppliers: number | null;
  official_url: string | null;
  items_loaded_at: Date | null;
  documents_checked_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_changed_at: Date | null;
  is_demo: boolean;
  institution_id: number | null;
  institution_name: string | null;
  institution_acronym: string | null;
  institution_slug: string | null;
};

export type ContractRow = {
  id: string;
  code: string;
  process_code: string | null;
  status: string | null;
  award_status: string | null;
  awarded_at: Date | null;
  created_at_source: Date | null;
  currency: string | null;
  amount: string | null;
  payment_method: string | null;
  payment_term: string | null;
  description: string | null;
  official_url: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_rpe: number | null;
  first_seen_at: Date;
  last_changed_at: Date | null;
};

export type ContractItemRow = {
  id: string;
  contract_id: string;
  contract_code: string;
  item_name: string | null;
  user_description: string | null;
  unit: string | null;
  quantity: string | null;
  unit_price: string | null;
  itbis: string | null;
  other_taxes: string | null;
  discounts: string | null;
  total: string | null;
  unspsc_subclass: string | null;
  category_name: string | null;
  currency: string | null;
};

export type ProcurementItemRow = {
  id: string;
  item_name: string | null;
  user_description: string | null;
  unit: string | null;
  quantity: string | null;
  unit_price_estimated: string | null;
  total_estimated: string | null;
  unspsc_subclass: string | null;
};

export type DocumentRow = { id: string; name: string; doc_type: string | null; uploaded_at: Date | null; url: string };
export type AmendmentRow = {
  id: string;
  contract_code: string;
  amended_at: Date | null;
  description: string | null;
  amount_before: string | null;
  amount_after: string | null;
  currency: string | null;
  source_url: string | null;
};
export type PaymentRow = { id: string; contract_code: string; paid_at: Date | null; amount: string; currency: string; source_url: string | null };
export type ProcessAlertRow = {
  public_id: string;
  alert_type: string;
  title: string;
  summary: string;
  public_label: string;
  status: string;
  amount_involved: string | null;
  currency: string;
  last_evaluated_at: Date;
};
export type VersionRow = { observed_at: Date; changed_fields: Record<string, [unknown, unknown]>; entity: string };

export type ProcessDetail = {
  process: ProcessRow;
  contracts: ContractRow[];
  contractItems: ContractItemRow[];
  processItems: ProcurementItemRow[];
  bids: { total: number; distinct_suppliers: number; first_at: Date | null; last_at: Date | null };
  documents: DocumentRow[];
  amendments: AmendmentRow[];
  payments: PaymentRow[];
  alerts: ProcessAlertRow[];
  versions: VersionRow[];
  projects: { id: number; name: string; snip_code: string | null }[];
};

const PROCESS_COLUMNS = `
  p.id::text, p.code, p.title, p.description, p.modality, p.exception_type, p.status, p.currency,
  p.estimated_amount::text, p.published_at, p.amended_at, p.bids_deadline_at, p.bids_opening_at,
  p.estimated_award_at, p.estimated_signing_at, p.object_type, p.object_subtype, p.requesting_area,
  p.for_mipymes, p.is_lotified, p.snip_code, p.planned, p.contract_duration, p.notified_suppliers,
  p.official_url, p.items_loaded_at, p.documents_checked_at, p.first_seen_at, p.last_seen_at,
  p.last_changed_at, p.is_demo, i.id as institution_id, i.name as institution_name,
  i.acronym as institution_acronym, i.slug as institution_slug`;

export async function getProcessByCode(code: string): Promise<ProcessDetail | null> {
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [process] = await sql<ProcessRow[]>`
    select ${sql.unsafe(PROCESS_COLUMNS)}
    from procurement_processes p left join institutions i on i.id = p.institution_id
    where p.code = ${code} and (${demo}::boolean or not p.is_demo)`;
  if (!process) return null;
  const pid = process.id;

  const [contracts, contractItems, processItems, bids, documents, amendments, payments, alerts, versions, projects] =
    await Promise.all([
      sql<ContractRow[]>`
        select c.id::text, c.code, c.process_code, c.status, c.award_status, c.awarded_at, c.created_at_source,
               c.currency, c.amount::text, c.payment_method, c.payment_term, c.description, c.official_url,
               c.supplier_id, coalesce(s.name, c.supplier_name) as supplier_name, c.supplier_rpe,
               c.first_seen_at, c.last_changed_at
        from contracts c left join suppliers s on s.id = c.supplier_id
        where c.process_id = ${pid}::bigint
        order by c.awarded_at nulls last, c.code`,
      sql<ContractItemRow[]>`
        select ci.id::text, ci.contract_id::text, c.code as contract_code, ci.item_name, ci.user_description, ci.unit,
               ci.quantity::text, ci.unit_price::text, ci.itbis::text, ci.other_taxes::text, ci.discounts::text,
               ci.total::text, ci.unspsc_subclass, u.name as category_name, c.currency
        from contract_items ci join contracts c on c.id = ci.contract_id
        left join unspsc_categories u on u.code = ci.unspsc_subclass
        where c.process_id = ${pid}::bigint
        order by c.code, ci.total desc nulls last
        limit 300`,
      sql<ProcurementItemRow[]>`
        select pi.id::text, pi.item_name, pi.user_description, pi.unit, pi.quantity::text,
               pi.unit_price_estimated::text, pi.total_estimated::text, pi.unspsc_subclass
        from procurement_items pi where pi.process_id = ${pid}::bigint
        order by pi.total_estimated desc nulls last limit 300`,
      sql<{ total: number; distinct_suppliers: number; first_at: Date | null; last_at: Date | null }[]>`
        select count(*)::int as total, count(distinct coalesce(supplier_rpe::text, supplier_name))::int as distinct_suppliers,
               min(submitted_at) as first_at, max(submitted_at) as last_at
        from bids where process_id = ${pid}::bigint`,
      sql<DocumentRow[]>`
        select id::text, name, doc_type, uploaded_at, url from source_documents
        where process_id = ${pid}::bigint order by uploaded_at nulls last, name`,
      sql<AmendmentRow[]>`
        select a.id::text, c.code as contract_code, a.amended_at, a.description, a.amount_before::text,
               a.amount_after::text, a.currency, a.source_url
        from contract_amendments a join contracts c on c.id = a.contract_id
        where c.process_id = ${pid}::bigint order by a.amended_at nulls last`,
      sql<PaymentRow[]>`
        select pm.id::text, c.code as contract_code, pm.paid_at, pm.amount::text, pm.currency, pm.source_url
        from payments pm join contracts c on c.id = pm.contract_id
        where c.process_id = ${pid}::bigint order by pm.paid_at nulls last`,
      sql<ProcessAlertRow[]>`
        select public_id, alert_type, title, summary, public_label, status, amount_involved::text, currency,
               last_evaluated_at
        from alerts
        where (process_id = ${pid}::bigint or contract_id in (select id from contracts where process_id = ${pid}::bigint))
          and status in ('publicada', 'retirada', 'aclarada')
        order by (status = 'publicada') desc, priority_score desc`,
      sql<VersionRow[]>`
        select observed_at, changed_fields, entity from record_versions
        where (entity = 'process' and entity_id = ${pid}::bigint)
           or (entity = 'contract' and entity_id in (select id from contracts where process_id = ${pid}::bigint))
        order by observed_at desc limit 20`,
      sql<{ id: number; name: string; snip_code: string | null }[]>`
        select distinct pr.id, pr.name, pr.snip_code from project_procurement_links l
        join investment_projects pr on pr.id = l.project_id
        where l.process_code = ${process.code}
           or l.contract_code in (select code from contracts where process_id = ${pid}::bigint)
        limit 10`,
    ]);

  return {
    process,
    contracts,
    contractItems,
    processItems,
    bids: bids[0] ?? { total: 0, distinct_suppliers: 0, first_at: null, last_at: null },
    documents,
    amendments,
    payments,
    alerts,
    versions,
    projects,
  };
}

export async function getContractProcessCode(code: string): Promise<{ process_code: string | null; exists: boolean }> {
  const sql = getSql();
  const rows = await sql<{ process_code: string | null; has_process: boolean }[]>`
    select c.process_code, (c.process_id is not null) as has_process from contracts c where c.code = ${code}`;
  if (!rows[0]) return { process_code: null, exists: false };
  return { process_code: rows[0].has_process ? rows[0].process_code : null, exists: true };
}

export type ContractDetail = ContractRow & {
  institution_name: string | null;
  institution_slug: string | null;
  items: ContractItemRow[];
};

/** Contratos cuyo proceso no está en nuestra base: ficha propia del contrato. */
export async function getContractByCode(code: string): Promise<ContractDetail | null> {
  const sql = getSql();
  const [c] = await sql<(ContractRow & { institution_name: string | null; institution_slug: string | null })[]>`
    select c.id::text, c.code, c.process_code, c.status, c.award_status, c.awarded_at, c.created_at_source,
           c.currency, c.amount::text, c.payment_method, c.payment_term, c.description, c.official_url,
           c.supplier_id, coalesce(s.name, c.supplier_name) as supplier_name, c.supplier_rpe, c.first_seen_at,
           c.last_changed_at, i.name as institution_name, i.slug as institution_slug
    from contracts c left join suppliers s on s.id = c.supplier_id left join institutions i on i.id = c.institution_id
    where c.code = ${code}`;
  if (!c) return null;
  const items = await sql<ContractItemRow[]>`
    select ci.id::text, ci.contract_id::text, ${c.code} as contract_code, ci.item_name, ci.user_description, ci.unit,
           ci.quantity::text, ci.unit_price::text, ci.itbis::text, ci.other_taxes::text, ci.discounts::text,
           ci.total::text, ci.unspsc_subclass, u.name as category_name, ${c.currency} as currency
    from contract_items ci left join unspsc_categories u on u.code = ci.unspsc_subclass
    where ci.contract_id = ${c.id}::bigint order by ci.total desc nulls last limit 300`;
  return { ...c, items };
}

/** Resumen para /compras: solo conteos y montos contratados en DOP (una sola etapa). */
export async function getProcurementOverview() {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [byModality, byMonth, topInstitutions, topSuppliers, statusCounts] = await Promise.all([
    sql<{ modality: string; processes: number }[]>`
      select modality, count(*)::int as processes from procurement_processes
      where (${demo}::boolean or not is_demo) and modality is not null
        and published_at >= date_trunc('year', now() at time zone 'America/Santo_Domingo')
      group by 1 order by 2 desc`,
    sql<{ month: string; contracts: number; contracted_dop: string | null }[]>`
      select to_char(date_trunc('month', awarded_at at time zone 'America/Santo_Domingo'), 'YYYY-MM') as month,
             count(*)::int as contracts,
             sum(amount) filter (where currency = 'DOP')::text as contracted_dop
      from contracts
      where (${demo}::boolean or not is_demo) and awarded_at >= (date_trunc('month', now()) - interval '11 months')
      group by 1 order by 1`,
    sql<{ id: number; name: string; slug: string; contracts: number; contracted_dop: string | null }[]>`
      select i.id, i.name, i.slug, count(*)::int as contracts,
             sum(c.amount) filter (where c.currency = 'DOP')::text as contracted_dop
      from contracts c join institutions i on i.id = c.institution_id
      where (${demo}::boolean or not c.is_demo) and c.awarded_at >= date_trunc('year', now() at time zone 'America/Santo_Domingo')
      group by i.id order by count(*) desc limit 8`,
    sql<{ id: number; name: string; contracts: number; contracted_dop: string | null }[]>`
      select s.id, s.name, count(*)::int as contracts,
             sum(c.amount) filter (where c.currency = 'DOP')::text as contracted_dop
      from contracts c join suppliers s on s.id = c.supplier_id
      where (${demo}::boolean or not c.is_demo) and c.awarded_at >= date_trunc('year', now() at time zone 'America/Santo_Domingo')
      group by s.id order by count(*) desc limit 8`,
    sql<{ open: number; awarded: number; total_year: number }[]>`
      select count(*) filter (where status in ('Proceso publicado', 'Sobres abiertos o aperturados',
                                               'Sobres estan abriendose', 'Proceso con etapa cerrada'))::int as open,
             count(*) filter (where status = 'Proceso adjudicado y celebrado')::int as awarded,
             count(*)::int as total_year
      from procurement_processes
      where (${demo}::boolean or not is_demo)
        and published_at >= date_trunc('year', now() at time zone 'America/Santo_Domingo')`,
  ]);
  return { byModality, byMonth, topInstitutions, topSuppliers, statusCounts: statusCounts[0] };
}

export const OPEN_STATUSES = [
  "Proceso publicado",
  "Sobres abiertos o aperturados",
  "Sobres estan abriendose",
  "Proceso con etapa cerrada",
];
