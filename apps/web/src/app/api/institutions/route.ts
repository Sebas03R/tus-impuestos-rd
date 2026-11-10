import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { listInstitutions } from "@/lib/queries/entities";

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get("pagina")) || 1));
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limite")) || 50));
    const r = await listInstitutions({ q: url.searchParams.get("q")?.slice(0, 120) ?? undefined, page, limit });
    const rows = r.rows.map(({ total: _t, ...x }) => x);
    if (wantsCsv(url)) return csv(rows, "instituciones", "DGCP — unidades de compra");
    return ok(rows, { page: r.page, limit: r.limit, total: r.total, pages: r.pages }, 3600);
  });
}
