import { connection } from "next/server";
import { dbConfigured } from "@/lib/db";
import { PER_SITEMAP, SECTIONS, sectionCounts, xmlEscape } from "@/lib/sitemap";
import { siteUrl } from "@/lib/site";

/** Índice de sitemaps paginado (cada archivo con un máximo de 40.000 URLs). */
export async function GET(request: Request) {
  void request;
  await connection();
  const base = siteUrl();
  let counts: Record<string, number> = { paginas: 1 };
  if (dbConfigured()) {
    try {
      counts = await sectionCounts();
    } catch {
      counts = { paginas: 1 };
    }
  }
  const entries: string[] = [];
  for (const s of SECTIONS) {
    const pages = Math.ceil((counts[s] ?? 0) / PER_SITEMAP);
    for (let i = 0; i < pages; i++) entries.push(`<sitemap><loc>${xmlEscape(`${base}/sitemaps/${s}/${i}`)}</loc></sitemap>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</sitemapindex>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, s-maxage=21600" } });
}
