import { csv, guard, handle, ok, wantsCsv } from "@/lib/api";
import { parseSearch } from "@/lib/queries/filters";
import { search } from "@/lib/queries/search";

export async function GET(request: Request) {
  const blocked = await guard(request, { expensive: true });
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const r = await search(parseSearch(url.searchParams));
    if (wantsCsv(url)) {
      return csv(
        r.hits.map((h) => ({
          tipo: h.entity_type, codigo: h.ref_code, titulo: h.title, institucion: h.institution_name, proveedor: h.supplier_name,
          tipo_de_monto: h.amount_type, monto: h.amount, moneda: h.currency, fecha: h.event_date, modalidad: h.modality,
          estado: h.status, provincia: h.province, con_alerta: h.has_alert, enlace: h.href,
        })),
        "busqueda-tus-impuestos-rd",
        "DGCP y MapaInversiones (datos abiertos)",
      );
    }
    return ok(r.hits, { page: r.page, limit: r.limit, total: r.total, pages: r.pages, fuzzy: r.fuzzy, corrected: "corrected" in r ? (r.corrected ?? null) : null });
  });
}
