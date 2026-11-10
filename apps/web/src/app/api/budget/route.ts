import { guard, handle, ok } from "@/lib/api";
import { BUDGET_UNIVERSES, getBudgetBreakdown, getBudgetSummary } from "@/lib/queries/fiscal";

const DIMS = ["sector", "institution", "function", "funding"] as const;

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const url = new URL(request.url);
    const summary = await getBudgetSummary();
    const universe = url.searchParams.get("universo");
    const year = Number(url.searchParams.get("anio"));
    const by = url.searchParams.get("por") as (typeof DIMS)[number] | null;
    const section = url.searchParams.get("seccion");
    const breakdown =
      universe && BUDGET_UNIVERSES[universe] && year && by && DIMS.includes(by)
        ? await getBudgetBreakdown(universe, section || null, year, by)
        : null;
    return ok(
      { universes: BUDGET_UNIVERSES, summary, breakdown },
      {
        source: "MapaInversiones y datos.gob.do (Ministerio de Hacienda)",
        warning: "Cada universo y cada sección son conjuntos distintos: no se suman entre sí. 'paid' es nulo cuando no hay fuente abierta.",
      },
      3600,
    );
  });
}
