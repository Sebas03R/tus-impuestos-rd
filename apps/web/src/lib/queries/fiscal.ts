import "server-only";
import { cacheLife } from "next/cache";
import { getSql } from "@/lib/db";
import { getDataMode } from "@/lib/queries/system";

/** Universos presupuestarios: nunca se suman entre sí, ni entre secciones institucionales. */
export const BUDGET_UNIVERSES: Record<string, { title: string; description: string; source: string; by: ("sector" | "institution" | "function" | "funding")[] }> = {
  inversion_mapainversiones: {
    title: "Presupuesto de inversión pública",
    description:
      "Proyectos de inversión del Gobierno central registrados por el Ministerio de Hacienda y publicados en MapaInversiones. No incluye el gasto corriente (salarios, servicios, transferencias).",
    source: "MapaInversiones — DatosabiertosPresupuestoHacienda.csv",
    by: ["sector", "institution", "funding"],
  },
  ejecucion_hacienda_institucion: {
    title: "Ejecución del gasto por institución",
    description:
      "Series anuales del Ministerio de Hacienda (datos.gob.do) por capítulo institucional. Cada sección del sector público se muestra por separado.",
    source: "datos.gob.do — Ministerio de Hacienda, ejecución de gastos y aplicaciones financieras",
    by: ["institution"],
  },
  ejecucion_hacienda_funcion: {
    title: "Ejecución del gasto por finalidad y función",
    description:
      "Series anuales del Ministerio de Hacienda (datos.gob.do) según la clasificación funcional: para qué se gasta (educación, salud, transporte…).",
    source: "datos.gob.do — Ministerio de Hacienda, ejecución de gastos y aplicaciones financieras",
    by: ["sector", "function"],
  },
};

export type BudgetYearRow = {
  universe: string;
  section: string | null;
  year: number;
  approved: string | null;
  current: string | null;
  accrued: string | null;
  paid: string | null;
  records: number;
  approximate: boolean;
  source_updated_at: Date | string | null;
};

export async function getBudgetSummary() {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  return sql<BudgetYearRow[]>`
    select universe, classification->>'seccion' as section, year, sum(approved)::text as approved,
           sum(current)::text as current, sum(accrued)::text as accrued, sum(paid)::text as paid, count(*)::int as records,
           coalesce(bool_or((classification->>'montos_aproximados_en_fuente')::boolean), false) as approximate,
           max(source_updated_at) as source_updated_at
    from budget_records where currency = 'DOP'
    group by universe, classification->>'seccion', year
    order by universe, section nulls first, year desc`;
}

export async function getBudgetBreakdown(
  universe: string,
  section: string | null,
  year: number,
  by: "sector" | "institution" | "function" | "funding",
) {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const col =
    by === "sector" ? sql`sector` : by === "function" ? sql`function_name` : by === "funding" ? sql`funding_source` : sql`institution_name`;
  return sql<{ label: string | null; approved: string | null; current: string | null; accrued: string | null; approximate: boolean }[]>`
    select ${col} as label, sum(approved)::text as approved, sum(current)::text as current, sum(accrued)::text as accrued,
           coalesce(bool_or((classification->>'montos_aproximados_en_fuente')::boolean), false) as approximate
    from budget_records
    where universe = ${universe} and year = ${year} and currency = 'DOP'
      and ${section === null ? sql`classification->>'seccion' is null` : sql`classification->>'seccion' = ${section}`}
    group by 1 order by sum(current) desc nulls last limit 15`;
}

export type ProjectListRow = {
  id: number;
  snip_code: string | null;
  name: string;
  status: string | null;
  project_value: string | null;
  currency: string;
  sector: string | null;
  executing_entity: string | null;
  start_date: Date | string | null;
  end_date: Date | string | null;
  physical_progress_pct: string | null;
  financial_progress_pct: string | null;
  provinces: string | null;
  total: number;
};

export async function listProjects(opts: {
  provincia?: string;
  municipio?: string;
  institucion?: string;
  estado?: string;
  sector?: string;
  anio?: number;
  q?: string;
  page?: number;
  limit?: number;
}) {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(opts.limit ?? 20, 100);
  const page = opts.page ?? 1;
  const rows = await sql<ProjectListRow[]>`
    select pr.id, pr.snip_code, pr.name, pr.status, pr.project_value::text, pr.currency, pr.sector, pr.executing_entity,
           pr.start_date, pr.end_date, pr.physical_progress_pct::text, pr.financial_progress_pct::text,
           (select string_agg(distinct l.province, ', ') from project_locations l
             where l.project_id = pr.id and not l.is_national) as provinces,
           count(*) over()::int as total
    from investment_projects pr
    where (${demo}::boolean or not pr.is_demo)
      ${opts.provincia ? sql`and exists (select 1 from project_locations l where l.project_id = pr.id and l.province = ${opts.provincia})` : sql``}
      ${opts.municipio ? sql`and exists (select 1 from project_locations l where l.project_id = pr.id and l.municipality = ${opts.municipio})` : sql``}
      ${opts.institucion ? sql`and pr.executing_entity = ${opts.institucion}` : sql``}
      ${opts.estado ? sql`and pr.status = ${opts.estado}` : sql``}
      ${opts.sector ? sql`and pr.sector = ${opts.sector}` : sql``}
      ${opts.anio ? sql`and extract(year from pr.start_date) = ${opts.anio}` : sql``}
      ${opts.q ? sql`and lower(public.f_unaccent(pr.name)) like ${"%" + opts.q.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "") + "%"}` : sql``}
    order by pr.start_date desc nulls last, pr.id desc
    limit ${limit} offset ${(page - 1) * limit}`;
  const total = rows[0]?.total ?? 0;
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function projectFacets(provincia?: string) {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const municipalities = provincia
    ? await sql<{ value: string; n: number }[]>`
        select municipality as value, count(distinct project_id)::int as n from project_locations
        where province = ${provincia} and municipality is not null group by 1 order by 1`
    : [];
  const [provinces, statuses, sectors, entities] = await Promise.all([
    sql<{ province: string; n: number }[]>`
      select l.province, count(distinct l.project_id)::int as n from project_locations l
      join investment_projects pr on pr.id = l.project_id
      where not l.is_national and l.province is not null and (${demo}::boolean or not pr.is_demo)
      group by 1 order by 1`,
    sql<{ value: string; n: number }[]>`
      select status as value, count(*)::int as n from investment_projects where status is not null and (${demo}::boolean or not is_demo)
      group by 1 order by 2 desc`,
    sql<{ value: string; n: number }[]>`
      select sector as value, count(*)::int as n from investment_projects where sector is not null and (${demo}::boolean or not is_demo)
      group by 1 order by 2 desc`,
    sql<{ value: string; n: number }[]>`
      select executing_entity as value, count(*)::int as n from investment_projects
      where executing_entity is not null and (${demo}::boolean or not is_demo) group by 1 order by 2 desc limit 80`,
  ]);
  const national = await sql<{ n: number }[]>`
    select count(distinct project_id)::int as n from project_locations where is_national`;
  return { provinces, statuses, sectors, entities, municipalities, national: national[0]?.n ?? 0 };
}

export type ProjectDetail = {
  project: {
    id: number;
    source_key: string;
    snip_code: string | null;
    name: string;
    status: string | null;
    project_value: string | null;
    currency: string;
    sector: string | null;
    executing_entity: string | null;
    start_date: Date | string | null;
    end_date: Date | string | null;
    physical_progress_pct: string | null;
    financial_progress_pct: string | null;
    objective: string | null;
    project_type: string | null;
    source_name: string | null;
    source_cut_at: Date | null;
    funding: unknown;
    last_seen_at: Date;
  };
  locations: { region: string | null; province: string | null; municipality: string | null; is_national: boolean }[];
  links: {
    process_code: string | null;
    contract_code: string | null;
    link_source: string;
    amount: string | null;
    currency: string | null;
    supplier_name: string | null;
    description: string | null;
    in_db: boolean;
  }[];
  budget: { year: number; approved: string | null; current: string | null; accrued: string | null }[];
};

export async function getProject(id: number): Promise<ProjectDetail | null> {
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [project] = await sql<ProjectDetail["project"][]>`
    select id, source_key, snip_code, name, status, project_value::text, currency, sector, executing_entity, start_date,
           end_date, physical_progress_pct::text, financial_progress_pct::text, objective, project_type, source_name,
           source_cut_at, funding, last_seen_at
    from investment_projects where id = ${id} and (${demo}::boolean or not is_demo)`;
  if (!project) return null;
  const [locations, links, budget] = await Promise.all([
    sql<ProjectDetail["locations"]>`
      select region, province, municipality, is_national from project_locations where project_id = ${id}
      order by province, municipality`,
    sql<ProjectDetail["links"]>`
      select l.process_code, l.contract_code, l.link_source, l.amount::text, l.currency, l.supplier_name, l.description,
             exists (select 1 from procurement_processes p where p.code = l.process_code) as in_db
      from project_procurement_links l where l.project_id = ${id} order by l.amount desc nulls last limit 50`,
    project.snip_code
      ? sql<ProjectDetail["budget"]>`
          select year, sum(approved)::text as approved, sum(current)::text as current, sum(accrued)::text as accrued
          from budget_records where universe = 'inversion_mapainversiones' and snip_code = ${project.snip_code}
          group by year order by year desc`
      : Promise.resolve([] as ProjectDetail["budget"]),
  ]);
  return { project, locations, links, budget };
}

export async function getMethodology() {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const [rules, thresholds, sources] = await Promise.all([
    sql<{
      code: string;
      version: number;
      name: string;
      public_description: string;
      technical_description: string;
      params: Record<string, unknown>;
      active: boolean;
      publishable: boolean;
      created_at: Date;
      change_note: string | null;
    }[]>`
      select distinct on (code) code, version, name, public_description, technical_description, params, active,
             publishable, created_at, change_note
      from detection_rules order by code, version desc`,
    sql<{
      regime: string;
      modality: string;
      object_type: string;
      min_amount: string | null;
      max_amount: string | null;
      currency: string;
      valid_from: Date | string;
      valid_to: Date | string | null;
      source_name: string;
      source_url: string | null;
      verified: boolean;
      notes: string | null;
    }[]>`
      select regime, modality, object_type, min_amount::text, max_amount::text, currency, valid_from, valid_to,
             source_name, source_url, verified, notes
      from legal_thresholds order by valid_from desc, object_type, min_amount nulls first`,
    sql<{ code: string; name: string; update_frequency: string | null; status: string }[]>`
      select code, name, update_frequency, status from data_sources order by code`,
  ]);
  return { rules, thresholds, sources };
}
