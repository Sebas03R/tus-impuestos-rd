import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertCard } from "@/components/alert-card";
import { DataFreshness } from "@/components/data-status";
import { EmptyState, ErrorState, Notice, PageHeader, Pagination, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { ALERT_DISCLAIMER, ALERT_TYPE_LABEL, ALERT_TYPES, PUBLIC_LABEL } from "@/lib/labels";
import { alertTypeCounts, listAlerts } from "@/lib/queries/alerts";
import { flattenParams, toQuery } from "@/lib/queries/filters";

export const metadata: Metadata = {
  title: "Radar de Contrataciones: compras públicas que merecen una revisión",
  description: "Alertas automáticas basadas en datos oficiales: diferencias de precio y otros patrones inusuales, con evidencia y limitaciones.",
  alternates: { canonical: "/radar" },
};

export default function RadarPage(props: PageProps<"/radar">) {
  return (
    <>
      <PageHeader
        eyebrow="Radar de Contrataciones"
        title="Compras públicas que merecen una revisión"
        intro={<p>Nuestro sistema analiza datos oficiales para detectar diferencias de precios y otros patrones inusuales.</p>}
      >
        <div className="mt-5 max-w-3xl">
          <Notice tone="amber" title="Importante">
            {ALERT_DISCLAIMER} Las alertas se ordenan por evidencia e impacto económico, nunca por notoriedad política.{" "}
            <Link href="/metodologia" className="font-bold text-navy underline">Cómo funciona el análisis</Link>.
          </Notice>
        </div>
      </PageHeader>
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={5} label="Cargando alertas…" />}>
          <RadarList searchParams={props.searchParams} />
        </Suspense>
        <div className="mt-10">
          <Suspense fallback={null}>
            <DataFreshness />
          </Suspense>
        </div>
      </div>
    </>
  );
}

async function RadarList({ searchParams }: { searchParams: PageProps<"/radar">["searchParams"] }) {
  const raw = flattenParams(await searchParams);
  const tipo = (ALERT_TYPES as readonly string[]).includes(raw.tipo) ? raw.tipo : undefined;
  const etiqueta = raw.etiqueta && PUBLIC_LABEL[raw.etiqueta] ? raw.etiqueta : undefined;
  const page = Math.max(1, Math.min(1000, Number.parseInt(raw.pagina ?? "1", 10) || 1));
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let data, counts;
  try {
    [data, counts] = await Promise.all([listAlerts({ tipo, etiqueta, page }), alertTypeCounts()]);
  } catch {
    return <ErrorState />;
  }
  const countFor = (t: string) => counts.find((c) => c.alert_type === t)?.n ?? 0;
  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
      <nav aria-label="Tipos de alerta">
        <p className="eyebrow mb-2">Tipo de alerta</p>
        <ul className="flex flex-wrap gap-2 lg:flex-col">
          <li>
            <Link href="/radar" aria-current={!tipo ? "page" : undefined} className="flex min-h-12 items-center justify-between gap-3 border-2 border-ink px-3 font-bold text-navy no-underline hover:bg-sky aria-[current=page]:bg-sky">
              Todas <span className="tabular text-ink-muted">{formatNumber(counts.reduce((s, c) => s + c.n, 0))}</span>
            </Link>
          </li>
          {ALERT_TYPES.map((t) => (
            <li key={t}>
              <Link href={`/radar${toQuery({ tipo: t, etiqueta })}`} aria-current={tipo === t ? "page" : undefined} className="flex min-h-12 items-center justify-between gap-3 border-2 border-ink px-3 font-bold text-navy no-underline hover:bg-sky aria-[current=page]:bg-sky">
                {ALERT_TYPE_LABEL[t]} <span className="tabular text-ink-muted">{formatNumber(countFor(t))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="lista-alertas">
        <h2 id="lista-alertas" className="mb-4 text-xl font-bold">
          {data.total === 0 ? "Sin alertas publicadas" : `${formatNumber(data.total)} alertas publicadas, de mayor a menor prioridad de revisión`}
        </h2>
        {data.total === 0 ? (
          <EmptyState title={tipo ? "No hay alertas publicadas de este tipo" : "Todavía no hay alertas publicadas"}>
            Una alerta solo se publica si tiene identificación verificable del proceso, fuente oficial, regla aplicada,
            cálculos comprobables y limitaciones explícitas. Los casos con evidencia insuficiente quedan en análisis interno.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 xl:grid-cols-2">
            {data.rows.map((a) => (
              <li key={a.public_id}><AlertCard alert={a} /></li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} pages={data.pages} hrefFor={(n) => `/radar${toQuery({ tipo, etiqueta, pagina: n })}`} />
      </section>
    </div>
  );
}
