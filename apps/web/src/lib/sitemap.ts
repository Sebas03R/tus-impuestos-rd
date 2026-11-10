import "server-only";
import { getSql } from "@/lib/db";

export const PER_SITEMAP = 40_000;
export const SECTIONS = ["paginas", "compras", "radar", "instituciones", "proveedores", "obras"] as const;
export type Section = (typeof SECTIONS)[number];

export const STATIC_PATHS = [
  "/", "/buscar", "/compras", "/radar", "/presupuesto", "/obras", "/instituciones", "/proveedores", "/metodologia",
  "/ayuda", "/fuentes", "/acerca", "/privacidad", "/accesibilidad", "/correcciones", "/api/docs",
];

export async function sectionCounts(): Promise<Record<Section, number>> {
  const [r] = await getSql()<{ compras: number; radar: number; instituciones: number; proveedores: number; obras: number }[]>`
    select (select count(*)::int from procurement_processes where not is_demo) as compras,
           (select count(*)::int from alerts where status = 'publicada' and not is_demo) as radar,
           (select count(*)::int from institutions where not is_demo) as instituciones,
           (select count(distinct supplier_id)::int from contracts where supplier_id is not null and not is_demo) as proveedores,
           (select count(*)::int from investment_projects where not is_demo) as obras`;
  return { paginas: STATIC_PATHS.length, ...r };
}

export async function sectionUrls(section: Section, page: number): Promise<{ path: string; lastmod: Date | string | null }[]> {
  const sql = getSql();
  const offset = page * PER_SITEMAP;
  switch (section) {
    case "paginas":
      return STATIC_PATHS.map((path) => ({ path, lastmod: null }));
    case "compras":
      return (await sql<{ code: string; lastmod: Date }[]>`
        select code, coalesce(last_changed_at, first_seen_at) as lastmod from procurement_processes where not is_demo
        order by id limit ${PER_SITEMAP} offset ${offset}`).map((r) => ({ path: `/compras/${encodeURIComponent(r.code)}`, lastmod: r.lastmod }));
    case "radar":
      return (await sql<{ public_id: string; lastmod: Date }[]>`
        select public_id, last_evaluated_at as lastmod from alerts where status = 'publicada' and not is_demo
        order by id limit ${PER_SITEMAP} offset ${offset}`).map((r) => ({ path: `/radar/${r.public_id}`, lastmod: r.lastmod }));
    case "instituciones":
      return (await sql<{ slug: string; lastmod: Date }[]>`
        select slug, last_seen_at as lastmod from institutions where not is_demo order by id limit ${PER_SITEMAP} offset ${offset}`).map((r) => ({ path: `/instituciones/${r.slug}`, lastmod: r.lastmod }));
    case "proveedores":
      return (await sql<{ id: number }[]>`
        select distinct supplier_id as id from contracts where supplier_id is not null and not is_demo
        order by 1 limit ${PER_SITEMAP} offset ${offset}`).map((r) => ({ path: `/proveedores/${r.id}`, lastmod: null }));
    case "obras":
      return (await sql<{ id: number; lastmod: Date }[]>`
        select id, last_seen_at as lastmod from investment_projects where not is_demo order by id limit ${PER_SITEMAP} offset ${offset}`).map((r) => ({ path: `/obras/${r.id}`, lastmod: r.lastmod }));
  }
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
