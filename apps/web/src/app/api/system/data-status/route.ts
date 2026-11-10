import { guard, handle, ok } from "@/lib/api";
import { getDataStatus, STALE_HOURS } from "@/lib/queries/system";

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const s = await getDataStatus();
    return ok(
      {
        mode: s.mode, stale: s.stale, stale_after_hours: STALE_HOURS, dgcp_last_success: s.dgcpLastSuccess,
        last_analysis: s.lastAnalysis, counts: s.counts,
        sources: s.sources.map((x) => ({ code: x.code, name: x.name, status: x.status, last_success_at: x.last_success_at, consecutive_failures: x.consecutive_failures, update_frequency: x.update_frequency })),
        recent_runs: s.lastRuns.map(({ error_detail: _e, ...r }) => r),
      },
      { source: "Tus Impuestos RD — registro interno de sincronizaciones" },
      60,
    );
  });
}
