import "server-only";
import { cacheLife } from "next/cache";
import { getSql } from "@/lib/db";
import { getDataMode } from "@/lib/queries/system";

export type InstitutionListRow = {
  id: number;
  name: string;
  acronym: string | null;
  kind: string | null;
  slug: string;
  processes: number;
  contracts: number;
  total: number;
};

export async function listInstitutions(opts: { q?: string; page?: number; limit?: number }) {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(opts.limit ?? 30, 100);
  const page = opts.page ?? 1;
  const q = opts.q?.trim();
  const rows = await sql<InstitutionListRow[]>`
    select i.id, i.name, i.acronym, i.kind, i.slug,
           (select count(*)::int from procurement_processes p where p.institution_id = i.id) as processes,
           (select count(*)::int from contracts c where c.institution_id = i.id) as contracts,
           count(*) over()::int as total
    from institutions i
    where (${demo}::boolean or not i.is_demo)
      ${q ? sql`and (lower(public.f_unaccent(i.name)) like ${"%" + q.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") + "%"}
               or lower(coalesce(i.acronym, '')) = ${q.toLowerCase()})` : sql``}
      and exists (select 1 from procurement_processes p where p.institution_id = i.id)
    order by processes desc, i.name
    limit ${limit} offset ${(page - 1) * limit}`;
  const total = rows[0]?.total ?? 0;
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export type InstitutionDetail = {
  institution: {
    id: number;
    source_key: number;
    name: string;
    acronym: string | null;
    kind: string | null;
    status: string | null;
    budget_chapter_code: string | null;
    slug: string;
    registered_at: Date | null;
    last_seen_at: Date;
  };
  byYear: { year: number; processes: number; contracts: number; contracted_dop: string | null; contracted_other: number }[];
  categories: { code: string | null; name: string | null; contracted_dop: string | null; contracts: number }[];
  suppliers: { id: number; name: string; contracts: number; contracted_dop: string | null }[];
  recent: { code: string; title: string | null; modality: string | null; status: string | null; published_at: Date | null; estimated_amount: string | null; currency: string | null }[];
  alerts: { public_id: string; alert_type: string; title: string; public_label: string; amount_involved: string | null; currency: string }[];
};

export async function getInstitution(key: string): Promise<InstitutionDetail | null> {
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const asId = /^\d+$/.test(key) ? Number(key) : -1;
  const [institution] = await sql<InstitutionDetail["institution"][]>`
    select id, source_key, name, acronym, kind, status, budget_chapter_code, slug, registered_at, last_seen_at
    from institutions where (slug = ${key} or id = ${asId}) and (${demo}::boolean or not is_demo) limit 1`;
  if (!institution) return null;
  const id = institution.id;
  const [byYear, categories, suppliers, recent, alerts] = await Promise.all([
    sql<InstitutionDetail["byYear"]>`
      with p as (
        select extract(year from published_at at time zone 'America/Santo_Domingo')::int as year, count(*)::int as processes
        from procurement_processes where institution_id = ${id} and published_at is not null group by 1
      ), c as (
        select extract(year from awarded_at at time zone 'America/Santo_Domingo')::int as year, count(*)::int as contracts,
               sum(amount) filter (where currency = 'DOP')::text as contracted_dop,
               count(*) filter (where currency is distinct from 'DOP')::int as contracted_other
        from contracts where institution_id = ${id} and awarded_at is not null group by 1
      )
      select coalesce(p.year, c.year) as year, coalesce(p.processes, 0) as processes, coalesce(c.contracts, 0) as contracts,
             c.contracted_dop, coalesce(c.contracted_other, 0) as contracted_other
      from p full join c on c.year = p.year order by 1 desc`,
    sql<InstitutionDetail["categories"]>`
      select ci.unspsc_family as code, u.name, sum(ci.total) filter (where c.currency = 'DOP')::text as contracted_dop,
             count(distinct c.id)::int as contracts
      from contract_items ci join contracts c on c.id = ci.contract_id
      left join unspsc_categories u on u.code = ci.unspsc_family
      where c.institution_id = ${id}
      group by 1, 2 order by sum(ci.total) filter (where c.currency = 'DOP') desc nulls last limit 8`,
    sql<InstitutionDetail["suppliers"]>`
      select s.id, s.name, count(*)::int as contracts, sum(c.amount) filter (where c.currency = 'DOP')::text as contracted_dop
      from contracts c join suppliers s on s.id = c.supplier_id
      where c.institution_id = ${id}
      group by s.id order by sum(c.amount) filter (where c.currency = 'DOP') desc nulls last limit 10`,
    sql<InstitutionDetail["recent"]>`
      select code, title, modality, status, published_at, estimated_amount::text, currency
      from procurement_processes where institution_id = ${id}
      order by published_at desc nulls last limit 10`,
    sql<InstitutionDetail["alerts"]>`
      select public_id, alert_type, title, public_label, amount_involved::text, currency
      from alerts where institution_id = ${id} and status = 'publicada'
      order by priority_score desc limit 10`,
  ]);
  return { institution, byYear, categories, suppliers, recent, alerts };
}

export type SupplierListRow = {
  id: number;
  rpe: number;
  name: string;
  province: string | null;
  supplies: string | null;
  contracts: number;
  institutions: number;
  total: number;
};

export async function listSuppliers(opts: { q?: string; provincia?: string; page?: number; limit?: number }) {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(opts.limit ?? 30, 100);
  const page = opts.page ?? 1;
  const q = opts.q?.trim();
  const rnc = q && /^\d{9,11}$/.test(q.replace(/-/g, "")) ? q.replace(/-/g, "") : null;
  const rows = await sql<SupplierListRow[]>`
    with agg as (
      select c.supplier_id, count(*)::int as contracts, count(distinct c.institution_id)::int as institutions
      from contracts c where c.supplier_id is not null and (${demo}::boolean or not c.is_demo) group by 1
    )
    select s.id, s.rpe, s.name, s.province, s.supplies, agg.contracts, agg.institutions, count(*) over()::int as total
    from suppliers s join agg on agg.supplier_id = s.id
    where true
      ${rnc ? sql`and s.rnc = ${rnc}` : q ? sql`and lower(public.f_unaccent(s.name)) like ${"%" + q.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") + "%"}` : sql``}
      ${opts.provincia ? sql`and s.province = ${opts.provincia}` : sql``}
    order by agg.contracts desc, s.name
    limit ${limit} offset ${(page - 1) * limit}`;
  const total = rows[0]?.total ?? 0;
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export type SupplierDetail = {
  supplier: {
    id: number;
    rpe: number;
    name: string;
    rnc: string | null;
    person_type: string | null;
    legal_form: string | null;
    status: string | null;
    is_mipyme: boolean | null;
    supplies: string | null;
    province: string | null;
    municipality: string | null;
    registered_at: Date | null;
    detail_loaded: boolean;
    last_seen_at: Date;
  };
  byYear: { year: number; contracts: number; contracted_dop: string | null; contracted_other: number }[];
  institutions: { id: number; name: string; slug: string; contracts: number; contracted_dop: string | null }[];
  categories: { code: string | null; name: string | null; contracts: number }[];
  contracts: { code: string; process_code: string | null; description: string | null; awarded_at: Date | null; amount: string | null; currency: string | null; institution_name: string | null; has_process: boolean }[];
  alerts: { public_id: string; alert_type: string; title: string; public_label: string }[];
};

export async function getSupplier(id: number): Promise<SupplierDetail | null> {
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [supplier] = await sql<SupplierDetail["supplier"][]>`
    select id, rpe, name, rnc, person_type, legal_form, status, is_mipyme, supplies, province, municipality,
           registered_at, detail_loaded, last_seen_at
    from suppliers where id = ${id} and (${demo}::boolean or not is_demo)`;
  if (!supplier) return null;
  const [byYear, institutions, categories, contracts, alerts] = await Promise.all([
    sql<SupplierDetail["byYear"]>`
      select extract(year from awarded_at at time zone 'America/Santo_Domingo')::int as year, count(*)::int as contracts,
             sum(amount) filter (where currency = 'DOP')::text as contracted_dop,
             count(*) filter (where currency is distinct from 'DOP')::int as contracted_other
      from contracts where supplier_id = ${id} and awarded_at is not null group by 1 order by 1 desc`,
    sql<SupplierDetail["institutions"]>`
      select i.id, i.name, i.slug, count(*)::int as contracts, sum(c.amount) filter (where c.currency = 'DOP')::text as contracted_dop
      from contracts c join institutions i on i.id = c.institution_id
      where c.supplier_id = ${id} group by i.id order by count(*) desc limit 12`,
    sql<SupplierDetail["categories"]>`
      select ci.unspsc_family as code, u.name, count(distinct c.id)::int as contracts
      from contract_items ci join contracts c on c.id = ci.contract_id
      left join unspsc_categories u on u.code = ci.unspsc_family
      where c.supplier_id = ${id} group by 1, 2 order by 3 desc limit 8`,
    sql<SupplierDetail["contracts"]>`
      select c.code, c.process_code, c.description, c.awarded_at, c.amount::text, c.currency, i.name as institution_name,
             (c.process_id is not null) as has_process
      from contracts c left join institutions i on i.id = c.institution_id
      where c.supplier_id = ${id} order by c.awarded_at desc nulls last limit 25`,
    sql<SupplierDetail["alerts"]>`
      select public_id, alert_type, title, public_label from alerts
      where supplier_id = ${id} and status = 'publicada' order by priority_score desc limit 10`,
  ]);
  return { supplier, byYear, institutions, categories, contracts, alerts };
}

export async function institutionOptions(): Promise<{ id: number; name: string; acronym: string | null }[]> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  return sql<{ id: number; name: string; acronym: string | null }[]>`
    select i.id, i.name, i.acronym from institutions i
    where exists (select 1 from procurement_processes p where p.institution_id = i.id)
    order by i.name`;
}

export async function supplierName(id: number): Promise<string | null> {
  const sql = getSql();
  const rows = await sql<{ name: string }[]>`select name from suppliers where id = ${id}`;
  return rows[0]?.name ?? null;
}
