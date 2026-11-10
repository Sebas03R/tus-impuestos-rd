import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { parseSearch } from "@/lib/queries/filters";
import { search } from "@/lib/queries/search";

export async function GET(request: Request) {
  const blocked = await guard(request, { expensive: true });
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const r = await search({ ...parseSearch(url.searchParams), tipo: "proceso" });
    const rows = r.hits.map((h) => ({
      codigo: h.ref_code, titulo: h.title, institucion: h.institution_name, modalidad: h.modality, estado: h.status,
      fecha_publicacion: h.event_date, monto_estimado: h.amount, moneda: h.currency, con_alerta: h.has_alert, enlace: h.href,
    }));
    if (wantsCsv(url)) return csv(rows, "procesos", "DGCP — procesos de compra");
    return ok(rows, { page: r.page, limit: r.limit, total: r.total, pages: r.pages, amount_type: "estimado" });
  });
}
