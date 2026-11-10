import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { parseSearch } from "@/lib/queries/filters";
import { searchContracts } from "@/lib/queries/search";

export async function GET(request: Request) {
  const blocked = await guard(request, { expensive: true });
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const r = await searchContracts({ ...parseSearch(url.searchParams), tipo: "contrato" });
    const rows = r.hits.map((h) => ({
      codigo: h.ref_code, descripcion: h.title, institucion: h.institution_name, proveedor: h.supplier_name, estado: h.status,
      fecha_adjudicacion: h.event_date, monto_contratado: h.amount, moneda: h.currency, enlace: h.href,
    }));
    if (wantsCsv(url)) return csv(rows, "contratos", "DGCP — contratos");
    return ok(rows, { page: r.page, limit: r.limit, total: r.total, pages: r.pages, amount_type: "contratado" });
  });
}
