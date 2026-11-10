import { connection } from "next/server";
import { dbConfigured } from "@/lib/db";
import { SECTIONS, sectionUrls, xmlEscape, type Section } from "@/lib/sitemap";
import { siteUrl } from "@/lib/site";

export async function GET(_request: Request, ctx: RouteContext<"/sitemaps/[section]/[page]">) {
  await connection();
  const { section, page } = await ctx.params;
  const n = Number(page);
  if (!(SECTIONS as readonly string[]).includes(section) || !Number.isInteger(n) || n < 0 || n > 100) {
    return new Response("No encontrado", { status: 404 });
  }
  if (section !== "paginas" && !dbConfigured()) return new Response("Servicio no disponible", { status: 503 });
  const urls = await sectionUrls(section as Section, n);
  const base = siteUrl();
  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : "";
      return `<url><loc>${xmlEscape(base + u.path)}</loc>${lastmod}</url>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, s-maxage=21600" } });
}
