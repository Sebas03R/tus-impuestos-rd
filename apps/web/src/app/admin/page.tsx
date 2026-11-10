import { Suspense } from "react";
import { connection } from "next/server";
import { Notice, Pill, Skeleton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { getSql } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getDataSources, getRecentRuns } from "@/lib/queries/system";
import { SyncForm } from "./forms";
import { AdminNav } from "./nav";

export const metadata = { title: "Estado del sistema" };

export default function AdminHome(props: PageProps<"/admin">) {
  return (
    <div className="container-page py-8">
      <Suspense fallback={<Skeleton lines={6} label="Cargando panel…" />}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await connection();
  const user = await requireRole("lector");
  const sp = await searchParams;
  const sql = getSql();
  const [sources, runs, counts, size, detection] = await Promise.all([
    getDataSources(),
    getRecentRuns(25),
    sql<{ processes: number; contracts: number; items: number; alerts_total: number; alerts_published: number; alerts_internal: number; corrections_open: number; rules: number }[]>`
      select (select count(*)::int from procurement_processes) as processes,
             (select count(*)::int from contracts) as contracts,
             (select count(*)::int from contract_items) as items,
             (select count(*)::int from alerts) as alerts_total,
             (select count(*)::int from alerts where status = 'publicada') as alerts_published,
             (select count(*)::int from alerts where status in ('interna', 'en_revision')) as alerts_internal,
             (select count(*)::int from correction_requests where status in ('recibida', 'en_revision')) as corrections_open,
             (select count(distinct code)::int from detection_rules where active) as rules`,
    sql<{ bytes: string }[]>`select pg_database_size(current_database())::text as bytes`,
    sql<{ id: string; started_at: Date; finished_at: Date | null; status: string; duration_ms: number | null; counts: Record<string, unknown> | null; error_detail: string | null }[]>`
      select id::text, started_at, finished_at, status, duration_ms, counts, error_detail from detection_runs order by id desc limit 10`,
  ]);
  const c = counts[0];
  const mb = Number(size[0]?.bytes ?? 0) / 1024 / 1024;
  const limitMb = Number(process.env.DB_SIZE_LIMIT_MB ?? 500);
  return (
    <div>
      <AdminNav user={user} />
      {sp.error === "permiso" && <div className="mb-4"><Notice tone="red">Tu rol no permite esa acción.</Notice></div>}
      <h1 className="text-2xl font-extrabold">Estado del sistema</h1>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Procesos", c.processes],
          ["Contratos", c.contracts],
          ["Artículos contratados", c.items],
          ["Reglas activas", c.rules],
          ["Alertas detectadas", c.alerts_total],
          ["Alertas publicadas", c.alerts_published],
          ["En análisis interno o revisión", c.alerts_internal],
          ["Correcciones pendientes", c.corrections_open],
        ].map(([l, v]) => (
          <div key={l as string} className="card p-4">
            <dt className="text-sm font-bold text-ink-muted">{l}</dt>
            <dd className="tabular text-2xl font-extrabold">{formatNumber(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <Notice tone={mb / limitMb > 0.8 ? "red" : "navy"} title="Tamaño de la base de datos">
          {formatNumber(mb, 1)} MB de {limitMb} MB ({formatNumber((mb / limitMb) * 100, 0)} %).{mb / limitMb > 0.8 && " Supera el 80 %: reduzca la ventana de sincronización o amplíe el plan."}
        </Notice>
      </div>

      <h2 className="mt-10 text-xl font-bold">Integraciones</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {sources.map((s) => (
          <li key={s.code} className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{s.name}</span>
              <Pill tone={s.status === "activa" ? "green" : s.status === "degradada" ? "amber" : "red"}>{s.status}</Pill>
            </div>
            <p className="text-sm">Último éxito: {formatDateTime(s.last_success_at)} · fallos seguidos: {s.consecutive_failures}</p>
          </li>
        ))}
      </ul>
      {user.role === "admin" && (
        <div className="card mt-4 p-4">
          <h3 className="font-bold">Reejecutar una sincronización</h3>
          <SyncForm />
        </div>
      )}

      <h2 className="mt-10 text-xl font-bold">Últimas sincronizaciones</h2>
      <div className="mt-3 relative overflow-x-auto" tabIndex={0} role="region" aria-label="Sincronizaciones (desplazable)">
        <table className="w-full bg-white text-left text-sm">
          <thead><tr className="border-b-2 border-line"><th className="p-2">#</th><th className="p-2">Trabajo</th><th className="p-2">Estado</th><th className="p-2">Inicio</th><th className="p-2">Duración</th><th className="p-2">Obtenidos</th><th className="p-2">Nuevos</th><th className="p-2">Cambiados</th><th className="p-2">Errores</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-line align-top">
                <td className="p-2">{r.id}</td><td className="p-2">{r.job}</td><td className="p-2">{r.status}</td><td className="p-2">{formatDateTime(r.started_at)}</td>
                <td className="p-2">{r.duration_ms ? `${Math.round(r.duration_ms / 1000)} s` : "—"}</td>
                <td className="tabular p-2">{formatNumber(r.records_fetched)}</td><td className="tabular p-2">{formatNumber(r.records_new)}</td><td className="tabular p-2">{formatNumber(r.records_changed)}</td>
                <td className="p-2">{r.errors ? <details><summary>{r.errors}</summary><pre className="max-w-xl whitespace-pre-wrap">{r.error_detail?.slice(0, 1500)}</pre></details> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold">Historial de análisis</h2>
      <ul className="mt-3 space-y-2">
        {detection.map((d) => (
          <li key={d.id} className="card p-3 text-sm">
            <strong>#{d.id}</strong> · {d.status} · {formatDateTime(d.started_at)} · {d.duration_ms ? `${Math.round(d.duration_ms / 1000)} s` : "—"}
            {d.counts && <pre className="mt-1 whitespace-pre-wrap text-xs">{JSON.stringify(d.counts)}</pre>}
            {d.error_detail && <p className="text-red-text">{d.error_detail.slice(0, 500)}</p>}
          </li>
        ))}
        {detection.length === 0 && <li>Aún no hay análisis registrados.</li>}
      </ul>
    </div>
  );
}
