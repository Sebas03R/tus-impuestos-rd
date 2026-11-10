import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import {
  AlertFacts,
  AlertHeader,
  asList,
  ComparisonDetails,
  DisclaimerBanner,
  GenericMetrics,
  PriceFigures,
  Proofs,
} from "@/components/alert-detail";
import { PrintButton } from "@/components/print-button";
import { ErrorState, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getAlert } from "@/lib/queries/alerts";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Informe de análisis", robots: { index: false } };

export default function ReportPage(props: PageProps<"/radar/[id]/informe">) {
  return (
    <div className="container-page max-w-4xl py-8">
      <Suspense fallback={<Skeleton lines={6} label="Preparando el informe…" />}>
        <Report params={props.params} />
      </Suspense>
    </div>
  );
}

async function Report({ params }: { params: PageProps<"/radar/[id]/informe">["params"] }) {
  const { id } = await params;
  await connection();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  const data = await getAlert(id).catch(() => undefined);
  if (data === undefined) return <ErrorState />;
  if (!data) notFound();
  const { alert, evidence } = data;
  const lists: [string, string[]][] = [
    ["Posibles explicaciones", asList(alert.possible_explanations)],
    ["Información faltante", asList(alert.missing_information)],
    ["Limitaciones", asList(alert.limitations)],
  ];
  return (
    <article className="space-y-6">
      <div className="flex items-center justify-between gap-3 no-print">
        <p className="text-ink-muted">Vista optimizada para imprimir o guardar como PDF.</p>
        <PrintButton />
      </div>
      <header className="border-b-2 border-navy pb-4">
        <p className="font-bold">Tus Impuestos RD — Informe de análisis del Radar de Contrataciones</p>
        <p className="text-sm">Generado el {formatDateTime(new Date())} · {siteUrl()}/radar/{alert.public_id}</p>
      </header>
      <DisclaimerBanner />
      <AlertHeader alert={alert} />
      <section><h2 className="text-xl font-bold">Qué ocurrió</h2><p>{alert.summary}</p></section>
      <section><h2 className="text-xl font-bold">Resultados comprobados</h2>{alert.alert_type === "precio" ? <PriceFigures alert={alert} /> : <GenericMetrics alert={alert} />}</section>
      <section><h2 className="text-xl font-bold">Por qué se generó</h2><p>{alert.why_flagged}</p></section>
      {lists.map(([t, items]) => (
        <section key={t}>
          <h2 className="text-xl font-bold">{t}</h2>
          {items.length ? <ul className="list-disc pl-6">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p>Sin registros.</p>}
        </section>
      ))}
      <section><h2 className="text-xl font-bold">Fuentes y evidencia</h2><Proofs evidence={evidence} /><div className="mt-3"><ComparisonDetails evidence={evidence} open /></div></section>
      <section><h2 className="text-xl font-bold">Datos de la alerta</h2><AlertFacts alert={alert} /></section>
      <section className="text-sm">
        <h2 className="text-xl font-bold">Metodología</h2>
        <p>Regla {alert.rule_code} versión {alert.rule_version}. Fuente principal: Dirección General de Contrataciones Públicas (datos abiertos). Metodología completa: {siteUrl()}/metodologia</p>
        <p className="mt-2">Tus Impuestos RD es una iniciativa independiente. No es un portal oficial del Gobierno dominicano.</p>
      </section>
    </article>
  );
}
