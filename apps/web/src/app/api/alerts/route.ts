import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { ALERT_DISCLAIMER, ALERT_TYPES, PUBLIC_LABEL } from "@/lib/labels";
import { listAlerts } from "@/lib/queries/alerts";

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const tipo = url.searchParams.get("tipo");
    const etiqueta = url.searchParams.get("etiqueta");
    const r = await listAlerts({
      tipo: tipo && (ALERT_TYPES as readonly string[]).includes(tipo) ? tipo : undefined,
      etiqueta: etiqueta && PUBLIC_LABEL[etiqueta] ? etiqueta : undefined,
      page: Math.max(1, Math.min(1000, Number(url.searchParams.get("pagina")) || 1)),
      limit: Math.max(1, Math.min(100, Number(url.searchParams.get("limite")) || 20)),
    });
    const rows = r.rows.map(({ total: _t, ...x }) => x);
    if (wantsCsv(url)) return csv(rows, "alertas", "Radar de Contrataciones de Tus Impuestos RD sobre datos de la DGCP");
    return ok(rows, { page: r.page, limit: r.limit, total: r.total, pages: r.pages, disclaimer: ALERT_DISCLAIMER }, 300);
  });
}
