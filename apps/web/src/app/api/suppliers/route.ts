import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { listSuppliers } from "@/lib/queries/entities";

export async function GET(request: Request) {
  const blocked = await guard(request, { expensive: true });
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("pagina")) || 1));
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limite")) || 50));
    const r = await listSuppliers({ q: url.searchParams.get("q")?.slice(0, 120) ?? undefined, page, limit });
    const rows = r.rows.map(({ total: _t, ...x }) => x);
    if (wantsCsv(url)) return csv(rows, "proveedores", "DGCP — Registro de Proveedores del Estado");
    return ok(rows, { page: r.page, limit: r.limit, total: r.total, pages: r.pages }, 1800);
  });
}
