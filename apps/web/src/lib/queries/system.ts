import "server-only";
import { cacheLife } from "next/cache";
import { getSql } from "@/lib/db";

export type DataSourceRow = {
  code: string;
  name: string;
  publisher: string;
  url: string;
  docs_url: string | null;
  license: string | null;
  status: string;
  status_detail: string | null;
  update_frequency: string | null;
  last_success_at: Date | null;
  last_attempt_at: Date | null;
  consecutive_failures: number;
};

export type SyncRunRow = {
  id: string;
  source_code: string;
  job: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  records_fetched: number;
  records_new: number;
  records_changed: number;
  errors: number;
  error_detail: string | null;
  trigger: string;
};

export async function getDataMode(): Promise<"real" | "demo"> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const rows = await sql<{ mode: string | null }[]>`
    select coalesce(value->>'mode', value #>> '{}') as mode from system_settings where key = 'data_mode'`;
  return rows[0]?.mode === "demo" ? "demo" : "real";
}

export async function getDataSources(): Promise<DataSourceRow[]> {
  const sql = getSql();
  return sql<DataSourceRow[]>`
    select code, name, publisher, url, docs_url, license, status, status_detail, update_frequency,
           last_success_at, last_attempt_at, consecutive_failures
    from data_sources order by case code when 'dgcp' then 0 when 'mapainversiones' then 1 else 2 end, code`;
}

export async function getRecentRuns(limit = 20): Promise<SyncRunRow[]> {
  const sql = getSql();
  return sql<SyncRunRow[]>`
    select id::text, source_code, job, status, started_at, finished_at, duration_ms, records_fetched,
           records_new, records_changed, errors, error_detail, trigger
    from sync_runs order by id desc limit ${limit}`;
}

export type DataStatus = {
  mode: "real" | "demo";
  dgcpLastSuccess: Date | null;
  lastAnalysis: Date | null;
  stale: boolean;
  sources: DataSourceRow[];
  lastRuns: SyncRunRow[];
  counts: { processes: number; contracts: number; alerts: number };
};

export const STALE_HOURS = 48;

/** Estado de los datos. La consulta se guarda en caché unos minutos; la frescura (`stale`) se
 * calcula fuera de la caché para que dependa de la hora real de la visita. */
export async function getDataStatus(): Promise<DataStatus> {
  const status = await loadDataStatus();
  const last = status.dgcpLastSuccess;
  const stale = !last || (Date.now() - new Date(last).getTime()) / 3_600_000 > STALE_HOURS;
  return { ...status, stale };
}

async function loadDataStatus(): Promise<Omit<DataStatus, "stale">> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const [sources, lastRuns, mode, analysis, counts] = await Promise.all([
    getDataSources(),
    getRecentRuns(10),
    getDataMode(),
    sql<{ finished_at: Date | null }[]>`
      select max(finished_at) as finished_at from detection_runs where status in ('success', 'partial')`,
    sql<{ processes: number; contracts: number; alerts: number }[]>`
      select (select count(*)::int from procurement_processes) as processes,
             (select count(*)::int from contracts) as contracts,
             (select count(*)::int from alerts where status = 'publicada') as alerts`,
  ]);
  const dgcp = sources.find((s) => s.code === "dgcp");
  const last = dgcp?.last_success_at ?? null;
  return {
    mode,
    dgcpLastSuccess: last,
    lastAnalysis: analysis[0]?.finished_at ?? null,
    sources,
    lastRuns,
    counts: counts[0] ?? { processes: 0, contracts: 0, alerts: 0 },
  };
}
