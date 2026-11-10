import { guard, handle, ok, problem } from "@/lib/api";
import { ALERT_DISCLAIMER } from "@/lib/labels";
import { getAlert } from "@/lib/queries/alerts";

export async function GET(request: Request, ctx: RouteContext<"/api/alerts/[id]">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const d = await getAlert((await ctx.params).id.slice(0, 40));
    if (!d) return problem(404, "No encontrada", "La alerta no existe o no es pública.");
    const { id: _internal, ...alert } = d.alert;
    return ok({ ...alert, history: d.history }, { disclaimer: ALERT_DISCLAIMER, source: "Radar de Contrataciones (Tus Impuestos RD) sobre datos de la DGCP" }, 300);
  });
}
