import "server-only";
import { cacheLife } from "next/cache";
import type { Fragment, Sql } from "postgres";
import { getSql } from "@/lib/db";
import { getDataMode } from "@/lib/queries/system";
import type { SearchParams } from "@/lib/queries/filters";

export type SearchHit = {
  entity_type: string;
  entity_id: string;
  ref_code: string | null;
  title: string;
  body: string | null;
  institution_id: number | null;
  institution_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  amount: string | null;
  amount_type: string | null;
  currency: string | null;
  event_date: Date | string | null;
  modality: string | null;
  status: string | null;
  province: string | null;
  has_alert: boolean;
  has_documents: boolean | null;
  /** Ruta pública de la ficha. */
  href: string;
};

export type SearchResult = {
  hits: SearchHit[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  fuzzy: boolean;
};

export const DEFAULT_LIMIT = 20;

/** Construye condiciones SQL parametrizadas a partir de los filtros validados. */
export type InternalSearch = SearchParams & { estados?: string[] };

export function buildFilters(sql: Sql, p: InternalSearch, demo: boolean): Fragment[] {
  const conds: unknown[] = [
    sql`(${demo}::boolean or not si.is_demo)`,
    p.estados && p.estados.length > 0 && sql`si.status in ${sql(p.estados)}`,
    p.tipo && sql`si.entity_type = ${p.tipo}`,
    p.institucion !== undefined && sql`si.institution_id = ${p.institucion}`,
    p.proveedor !== undefined && sql`si.supplier_id = ${p.proveedor}`,
    p.desde && sql`si.event_date >= ${p.desde}::date`,
    p.hasta && sql`si.event_date <= ${p.hasta}::date`,
    p.anio !== undefined && sql`si.year = ${p.anio}`,
    p.modalidad && sql`si.modality = ${p.modalidad}`,
    p.estado && sql`si.status = ${p.estado}`,
    p.objeto && sql`si.object_type = ${p.objeto}`,
    p.familia && sql`${p.familia} = any(si.unspsc_families)`,
    p.provincia && sql`si.province ilike ${"%" + p.provincia + "%"}`,
    p.moneda && sql`si.currency = ${p.moneda}`,
    p.min !== undefined && sql`si.amount >= ${p.min}`,
    p.max !== undefined && sql`si.amount <= ${p.max}`,
    p.alertas === true && sql`si.has_alert`,
    p.documentos === true && sql`si.has_documents is true`,
    p.documentos === false && sql`si.has_documents is false`,
  ];
  return conds.filter((c): c is Fragment => Boolean(c));
}

export function hrefFor(type: string, id: string, ref: string | null): string {
  switch (type) {
    case "proceso":
      return `/compras/${encodeURIComponent(ref ?? id)}`;
    case "contrato":
      return `/contratos/${encodeURIComponent(ref ?? id)}`;
    case "institucion":
      return `/instituciones/${id}`;
    case "proveedor":
      return `/proveedores/${id}`;
    case "obra":
      return `/obras/${id}`;
    default:
      return "/buscar";
  }
}

type Row = Omit<SearchHit, "href"> & { total: number };

const COLUMNS = `si.entity_type, si.entity_id::text, si.ref_code, si.title, left(si.body, 400) as body,
  si.institution_id, si.institution_name, si.supplier_id, si.supplier_name, si.amount::text, si.amount_type,
  si.currency, si.event_date, si.modality, si.status, si.province, si.has_alert, si.has_documents`;

/** Palabras normalizadas de la consulta (minúsculas, sin tildes). */
export function queryWords(q: string): string[] {
  return q
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
}

/** Parece un código oficial (p. ej. MINPRE-DAF-CM-2026-0049 o INFOTEP-2026-03132). */
export function looksLikeCode(q: string): boolean {
  return /^[A-Za-z0-9]+(-[A-Za-z0-9]+){1,6}$/.test(q.trim()) && /\d/.test(q);
}

export async function search(p: InternalSearch): Promise<SearchResult & { corrected?: string; direct?: SearchHit[] }> {
  "use cache";
  cacheLife("minutes");
  if (p.tipo === "contrato") return searchContracts(p);
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(p.limite ?? DEFAULT_LIMIT, 100);
  const page = p.pagina ?? 1;
  const offset = (page - 1) * limit;
  const q = p.q?.slice(0, 200);
  const where = sql`and`.join(buildFilters(sql, p, demo));
  let fuzzy = false;
  let corrected: string | undefined;
  let direct: SearchHit[] | undefined;

  const run = async (text: string | undefined) => {
    if (!text) {
      const sort = p.orden === "monto" ? sql`si.amount desc nulls last, si.id desc` : sql`si.event_date desc nulls last, si.id desc`;
      return sql<Row[]>`
        select ${sql.unsafe(COLUMNS)}, count(*) over()::int as total
        from search_index si where ${where}
        order by ${sort} limit ${limit} offset ${offset}`;
    }
    const sort =
      p.orden === "fecha"
        ? sql`si.event_date desc nulls last, si.id desc`
        : p.orden === "monto"
          ? sql`si.amount desc nulls last, si.id desc`
          : sql`rank desc, si.event_date desc nulls last`;
    return sql<Row[]>`
      with qq as (select websearch_to_tsquery('spanish', public.f_unaccent(${text})) as tsq)
      select ${sql.unsafe(COLUMNS)}, ts_rank_cd(si.tsv, qq.tsq) as rank, count(*) over()::int as total
      from search_index si, qq
      where ${where} and si.tsv @@ qq.tsq
      order by ${sort} limit ${limit} offset ${offset}`;
  };

  if (q && looksLikeCode(q) && page === 1) direct = await codeLookup(q, demo);

  let rows = await run(q);
  if (q && rows.length === 0 && page === 1) {
    // Tolerancia a errores de escritura: cada palabra se corrige con el término más parecido del vocabulario.
    const words = queryWords(q);
    const fixed: string[] = [];
    let changed = false;
    for (const w of words) {
      if (w.length < 4 || /\d/.test(w)) {
        fixed.push(w);
        continue;
      }
      const [best] = await sql<{ term: string }[]>`
        select term from search_terms where term % ${w} order by similarity(term, ${w}) desc, freq desc limit 1`;
      if (best && best.term !== w) changed = true;
      fixed.push(best?.term ?? w);
    }
    if (changed) {
      corrected = fixed.join(" ");
      rows = await run(corrected);
      fuzzy = true;
    }
  }

  const total = rows[0]?.total ?? 0;
  return {
    hits: rows.map(({ total: _t, ...r }) => ({ ...r, href: hrefFor(r.entity_type, r.entity_id, r.ref_code) })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    fuzzy,
    corrected,
    direct,
  };
}

/** Búsqueda directa por código oficial de proceso o contrato. */
async function codeLookup(q: string, demo: boolean): Promise<SearchHit[]> {
  const sql = getSql();
  const code = q.trim().toUpperCase();
  const rows = await sql<Row[]>`
    (select 'proceso' as entity_type, p.id::text as entity_id, p.code as ref_code, coalesce(p.title, p.code) as title,
            null::text as body, p.institution_id, i.name as institution_name, null::int as supplier_id, null::text as supplier_name,
            p.estimated_amount::text as amount, 'estimado' as amount_type, p.currency,
            (p.published_at at time zone 'America/Santo_Domingo')::date as event_date, p.modality, p.status, null::text as province,
            false as has_alert, null::boolean as has_documents, 0 as total
     from procurement_processes p left join institutions i on i.id = p.institution_id
     where (${demo}::boolean or not p.is_demo) and (p.code = ${code} or p.code like ${code + "%"})
     order by p.code limit 5)
    union all
    (select 'contrato', c.id::text, c.code, coalesce(c.description, c.code), null, c.institution_id, i.name, c.supplier_id,
            c.supplier_name, c.amount::text, 'contratado', c.currency,
            (coalesce(c.awarded_at, c.created_at_source) at time zone 'America/Santo_Domingo')::date, null, c.status, null,
            false, null, 0
     from contracts c left join institutions i on i.id = c.institution_id
     where (${demo}::boolean or not c.is_demo) and (c.code = ${code} or c.code like ${code + "%"})
     order by c.code limit 5)`;
  return rows.map(({ total: _t, ...r }) => ({ ...r, href: hrefFor(r.entity_type, r.entity_id, r.ref_code) }));
}

/** Los contratos no están en el índice unificado: se consultan directamente. */
export async function searchContracts(p: InternalSearch): Promise<SearchResult> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(p.limite ?? DEFAULT_LIMIT, 100);
  const page = p.pagina ?? 1;
  const q = p.q?.trim().slice(0, 200);
  const like = q ? `%${q.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()}%` : null;
  const conds: unknown[] = [
    sql`(${demo}::boolean or not c.is_demo)`,
    q && looksLikeCode(q) && sql`c.code like ${q.toUpperCase() + "%"}`,
    q && !looksLikeCode(q) && sql`(lower(public.f_unaccent(coalesce(c.description, ''))) like ${like}
                                   or lower(public.f_unaccent(coalesce(c.supplier_name, ''))) like ${like})`,
    p.institucion !== undefined && sql`c.institution_id = ${p.institucion}`,
    p.proveedor !== undefined && sql`c.supplier_id = ${p.proveedor}`,
    p.desde && sql`c.awarded_at >= ${p.desde}::date`,
    p.hasta && sql`c.awarded_at < (${p.hasta}::date + 1)`,
    p.anio !== undefined && sql`extract(year from c.awarded_at at time zone 'America/Santo_Domingo') = ${p.anio}`,
    p.moneda && sql`c.currency = ${p.moneda}`,
    p.min !== undefined && sql`c.amount >= ${p.min}`,
    p.max !== undefined && sql`c.amount <= ${p.max}`,
    p.estado && sql`c.status = ${p.estado}`,
    p.alertas === true && sql`exists (select 1 from alerts a where a.contract_id = c.id and a.status = 'publicada')`,
  ].filter((x): x is Fragment => Boolean(x));
  const sort = p.orden === "monto" ? sql`c.amount desc nulls last, c.id desc` : sql`c.awarded_at desc nulls last, c.id desc`;
  const rows = await sql<Row[]>`
    select 'contrato' as entity_type, c.id::text as entity_id, c.code as ref_code, coalesce(c.description, c.code) as title,
           null::text as body, c.institution_id, i.name as institution_name, c.supplier_id,
           coalesce(s.name, c.supplier_name) as supplier_name, c.amount::text as amount, 'contratado' as amount_type, c.currency,
           (coalesce(c.awarded_at, c.created_at_source) at time zone 'America/Santo_Domingo')::date as event_date,
           null::text as modality, c.status, s.province, false as has_alert, null::boolean as has_documents,
           count(*) over()::int as total
    from contracts c
    left join institutions i on i.id = c.institution_id
    left join suppliers s on s.id = c.supplier_id
    where ${sql`and`.join(conds)}
    order by ${sort} limit ${limit} offset ${(page - 1) * limit}`;
  const total = rows[0]?.total ?? 0;
  return {
    hits: rows.map(({ total: _t, ...r }) => ({ ...r, href: hrefFor("contrato", r.entity_id, r.ref_code) })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    fuzzy: false,
  };
}

/** Opciones de filtros (valores existentes) para los selectores. */
export async function searchFacets() {
  "use cache";
  cacheLife("hours");
  const sql = getSql();
  const [modalities, statuses, years, families] = await Promise.all([
    sql<{ value: string; n: number }[]>`
      select modality as value, count(*)::int as n from search_index
      where entity_type = 'proceso' and modality is not null group by 1 order by 2 desc limit 20`,
    sql<{ value: string; n: number }[]>`
      select status as value, count(*)::int as n from search_index
      where entity_type = 'proceso' and status is not null group by 1 order by 2 desc limit 20`,
    sql<{ value: number }[]>`
      select distinct year as value from search_index where year is not null order by 1 desc limit 10`,
    sql<{ value: string; name: string }[]>`
      select c.code as value, c.name from unspsc_categories c
      join (select distinct unspsc_family from contract_items where unspsc_family is not null) f
        on f.unspsc_family = c.code
      order by c.name limit 400`,
  ]);
  return { modalities, statuses, years: years.map((y) => y.value), families };
}
