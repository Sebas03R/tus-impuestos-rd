import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { listProjects } from "@/lib/queries/fiscal";

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k)?.slice(0, 200) || undefined;
    const r = await listProjects({
      provincia: g("provincia"), municipio: g("municipio"), institucion: g("institucion"), estado: g("estado"), sector: g("sector"),
      anio: /^\d{4}$/.test(g("anio") ?? "") ? Number(g("anio")) : undefined, q: g("q"),
      page: Math.max(1, Math.min(1000, Number(g("pagina")) || 1)),
      limit: Math.max(1, Math.min(100, Number(g("limite")) || 20)),
    });
    const rows = r.rows.map(({ total: _t, ...x }) => x);
    if (wantsCsv(url)) return csv(rows, "obras", "MapaInversiones — proyectos de inversión");
    return ok(rows, { page: r.page, limit: r.limit, total: r.total, pages: r.pages, source: "MapaInversiones", amount_type: "presupuesto del proyecto" }, 3600);
  });
}
