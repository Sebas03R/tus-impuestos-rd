import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ErrorState, ExternalA, PageHeader, Pill, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDateTime, relativeAge } from "@/lib/format";
import { DATA_SOURCE_STATUS } from "@/lib/labels";
import { getDataSources, getRecentRuns } from "@/lib/queries/system";

export const metadata: Metadata = {
  title: "Fuentes oficiales y estado de actualización",
  description: "De dónde vienen los datos, con qué frecuencia se actualizan y si cada fuente está funcionando.",
  alternates: { canonical: "/fuentes" },
};

export default function SourcesPage() {
  return (
    <>
      <PageHeader eyebrow="Procedencia" title="Fuentes oficiales" intro={<p>Solo usamos datos publicados por instituciones del Estado dominicano mediante APIs o archivos abiertos. No hacemos extracción agresiva ni evadimos restricciones de acceso.</p>} />
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={5} label="Consultando el estado de las fuentes…" />}>
          <Sources />
        </Suspense>
      </div>
    </>
  );
}

async function Sources() {
  await connection();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let sources, runs;
  try {
    [sources, runs] = await Promise.all([getDataSources(), getRecentRuns(15)]);
  } catch {
    return <ErrorState />;
  }
  return (
    <div className="space-y-10">
      <ul className="grid gap-4 lg:grid-cols-2">
        {sources.map((s) => {
          const st = DATA_SOURCE_STATUS[s.status] ?? { text: s.status, tone: "muted" as const };
          return (
            <li key={s.code} className="card flex flex-col gap-2 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{s.name}</h2>
                <Pill tone={st.tone}>{st.text}</Pill>
              </div>
              <p className="text-ink-muted">{s.publisher}</p>
              {s.status_detail && <p>{s.status_detail}</p>}
              <dl className="grid gap-1 text-[0.9375rem]">
                <div><dt className="inline font-bold">Frecuencia: </dt><dd className="inline">{s.update_frequency ?? "Sin dato"}</dd></div>
                <div><dt className="inline font-bold">Última actualización exitosa: </dt><dd className="inline">{s.last_success_at ? `${formatDateTime(s.last_success_at)} (${relativeAge(s.last_success_at)})` : "Aún no"}</dd></div>
                {s.license && <div><dt className="inline font-bold">Condiciones de uso: </dt><dd className="inline">{s.license}</dd></div>}
              </dl>
              <p className="mt-auto flex flex-wrap gap-4">
                <ExternalA href={s.url}>Fuente</ExternalA>
                {s.docs_url && <ExternalA href={s.docs_url}>Documentación</ExternalA>}
              </p>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="ejecuciones">
        <h2 id="ejecuciones" className="text-2xl font-extrabold">Últimas sincronizaciones</h2>
        <ul className="mt-4 space-y-2">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-2 border-ink p-3 text-[0.9375rem]">
              <Pill tone={r.status === "success" ? "green" : r.status === "running" ? "navy" : r.status === "partial" ? "amber" : "red"}>
                {r.status === "success" ? "Completa" : r.status === "running" ? "En curso" : r.status === "partial" ? "Con errores parciales" : "Fallida"}
              </Pill>
              <span className="font-bold">{r.source_code.toUpperCase()}</span>
              <span>{formatDateTime(r.started_at)}</span>
              <span className="text-ink-muted">{r.records_fetched.toLocaleString("es-DO")} registros revisados · {r.records_new.toLocaleString("es-DO")} nuevos · {r.records_changed.toLocaleString("es-DO")} con cambios</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
