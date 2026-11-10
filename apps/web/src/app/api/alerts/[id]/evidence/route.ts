import { guard, handle, ok, problem } from "@/lib/api";
import { ALERT_DISCLAIMER } from "@/lib/labels";
import { getAlertEvidenceByPublicId } from "@/lib/queries/alerts";

export async function GET(request: Request, ctx: RouteContext<"/api/alerts/[id]/evidence">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const d = await getAlertEvidenceByPublicId((await ctx.params).id.slice(0, 40));
    if (!d) return problem(404, "No encontrada", "La alerta no existe o no es pública.");
    return ok(
      {
        alert: d.alert.public_id, rule: d.alert.rule_code, rule_version: d.alert.rule_version,
        analysis_version: d.alert.current_version, evaluated_at: d.alert.last_evaluated_at, metrics: d.alert.metrics,
        evidence: d.evidence.map(({ id: _i, ...e }) => e),
      },
      { disclaimer: ALERT_DISCLAIMER, source: "Radar de Contrataciones (Tus Impuestos RD) sobre datos de la DGCP" },
      300,
    );
  });
}
