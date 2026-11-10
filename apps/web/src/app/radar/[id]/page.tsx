import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Printer } from "lucide-react";
import {
  AlertFacts,
  AlertHeader,
  asList,
  ComparisonDetails,
  DisclaimerBanner,
  GenericMetrics,
  HistoryTimeline,
  ListSection,
  PriceFigures,
  PriorityExplanation,
  Proofs,
  StatusNotice,
} from "@/components/alert-detail";
import { ShareButton } from "@/components/share";
import { Breadcrumbs, ErrorState, Money, SectionHeading, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { ALERT_TYPE_LABEL } from "@/lib/labels";
import { getAlert, getAlertShareMeta, type AlertShareMeta } from "@/lib/queries/alerts";
import { timesFromPct, timesPhrase, unitSingular } from "@/components/meters";
import { formatMoney, sentenceCase } from "@/lib/format";

async function alertMeta(id: string) {
  if (!dbConfigured()) return null;
  try {
    return await getAlertShareMeta(id);
  } catch {
    return null;
  }
}

/** Texto de vista previa (WhatsApp, redes): las cifras de la alerta, en una frase y sin adjetivos. */
function shareText(meta: AlertShareMeta): { title: string; description: string } {
  const disclaimer = "Datos oficiales de la DGCP. Una alerta merece revisión; no demuestra por sí sola una irregularidad.";
  const times = timesFromPct(meta.diff_pct);
  if (meta.alert_type === "precio" && times !== null && meta.paid && meta.reference) {
    const item = sentenceCase(meta.item) || "un artículo";
    const payer = meta.institution_acronym || meta.institution_name || "Una institución";
    const per = unitSingular(meta.unit);
    return {
      title: `${item}: pagó ${timesPhrase(times)}`,
      description: `${payer} pagó ${formatMoney(meta.paid, meta.currency, { decimals: 2 })} por ${per}; otras instituciones, ${formatMoney(meta.reference, meta.currency, { decimals: 2 })}. ${disclaimer}`,
    };
  }
  return {
    title: meta.title,
    description: `${ALERT_TYPE_LABEL[meta.alert_type] ?? "Alerta"}${meta.institution_name ? ` en ${meta.institution_name}` : ""}. ${disclaimer}`,
  };
}

export async function generateMetadata(props: PageProps<"/radar/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const meta = await alertMeta(id);
  if (!meta) return { title: "Alerta no encontrada", robots: { index: false } };
  const share = shareText(meta);
  return {
    title: meta.title,
    description: share.description,
    alternates: { canonical: `/radar/${id}` },
    openGraph: {
      title: share.title,
      description: share.description,
      type: "article",
      url: `/radar/${id}`,
      siteName: "Tus Impuestos RD",
      locale: "es_DO",
    },
    twitter: { card: "summary_large_image", title: share.title, description: share.description },
    robots: meta.status === "publicada" ? undefined : { index: false },
  };
}

export default function AlertPage(props: PageProps<"/radar/[id]">) {
  return (
    <div className="container-page py-8 md:py-10">
      <Suspense fallback={<Skeleton lines={6} label="Cargando la alerta…" />}>
        <AlertContent params={props.params} />
      </Suspense>
    </div>
  );
}

async function AlertContent({ params }: { params: PageProps<"/radar/[id]">["params"] }) {
  const { id } = await params;
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let data;
  try {
    data = await getAlert(id);
  } catch {
    return <ErrorState />;
  }
  if (!data) notFound();
  const { alert, evidence, history } = data;
  const isPrice = alert.alert_type === "precio";
  return (
    <article>
      <Breadcrumbs items={[{ href: "/", label: "Inicio" }, { href: "/radar", label: "Radar" }, { label: alert.public_id }]} />
      <DisclaimerBanner />
      <div className="mt-6">
        <AlertHeader alert={alert} />
      </div>
      <div className="mt-4">
        <StatusNotice alert={alert} history={history} />
      </div>

      <section aria-labelledby="que" className="mt-8">
        <SectionHeading id="que" title="¿Qué ocurrió?" />
        <p className="max-w-3xl text-lg">{alert.summary}</p>
      </section>

      <section aria-labelledby="cifras" className="mt-10">
        <SectionHeading id="cifras" title={isPrice ? "Los números de la comparación" : "Los datos utilizados"} />
        {isPrice ? <PriceFigures alert={alert} /> : <GenericMetrics alert={alert} />}
        {!isPrice && (
          <div className="card mt-4 inline-block max-w-full p-5">
            <Money value={alert.amount_involved} currency={alert.currency} type="contratado" size="lg" />
            <p className="text-sm text-ink-muted">Monto involucrado según los registros oficiales.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="porque" className="mt-10">
        <SectionHeading id="porque" title="¿Por qué estamos mostrando esta alerta?" />
        <p className="max-w-3xl">{alert.why_flagged}</p>
        {alert.rule_public_description && <p className="mt-3 max-w-3xl text-ink-muted">{alert.rule_public_description}</p>}
      </section>

      <ListSection
        id="explicar"
        title={isPrice ? "¿Qué podría explicar la diferencia?" : "¿Qué podría explicar esta situación?"}
        items={asList(alert.possible_explanations)}
        empty="Sin explicaciones registradas."
      />
      <ListSection id="falta" title="¿Qué información falta para llegar a una conclusión?" items={asList(alert.missing_information)} empty="No se registró información faltante." />
      <ListSection id="limites" title="Limitaciones del análisis" items={asList(alert.limitations)} empty="Sin limitaciones registradas." />

      <section aria-labelledby="pruebas" className="mt-10">
        <SectionHeading id="pruebas" title="Consulta las pruebas" intro="Registros y documentos originales en fuentes oficiales." />
        <Proofs evidence={evidence} />
        <div className="mt-4">
          <ComparisonDetails evidence={evidence} />
        </div>
      </section>

      <section aria-labelledby="prioridad" className="mt-10">
        <SectionHeading id="prioridad" title="¿Por qué tiene esta prioridad?" />
        <PriorityExplanation alert={alert} />
      </section>

      <section aria-labelledby="ficha" className="mt-10">
        <SectionHeading id="ficha" title="Datos de la alerta" />
        <AlertFacts alert={alert} />
        <div className="mt-4">
          <HistoryTimeline history={history} />
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-start gap-3 no-print">
        <ShareButton title={alert.title} text="Alerta del Radar de Contrataciones basada en datos oficiales. Merece revisión; no demuestra por sí sola una irregularidad." label="Compartir esta alerta" />
        <Link href={`/radar/${alert.public_id}/informe`} className="btn btn-quiet">
          <Printer aria-hidden="true" className="size-5" /> Informe para imprimir
        </Link>
        <a href={`/api/alerts/${alert.public_id}/evidence`} className="btn btn-quiet">Evidencia (JSON)</a>
        <Link href={`/correcciones?ref=${encodeURIComponent(alert.public_id)}&tipo=alerta`} className="btn btn-secondary">
          Aportar información o pedir una corrección
        </Link>
      </div>
      <div className="mt-8">
        <DisclaimerBanner />
      </div>
    </article>
  );
}
