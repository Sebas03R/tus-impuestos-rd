import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { cacheLife } from "next/cache";
import { Download, FileText, FileX, History } from "lucide-react";
import { AlertLabel, Breadcrumbs, Code, EmptyState, ErrorState, ExternalA, Field, Fig, Money, Notice, SectionHeading, Skeleton } from "@/components/ui";
import { ContractItems, ProcessItems } from "@/components/items";
import { CopyButton, ShareButton } from "@/components/share";
import { StageRail, type Stage } from "@/components/stage-rail";
import { dbConfigured, getSql } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, sentenceCase, SIN_DATO, textOr, truncate } from "@/lib/format";
import { ALERT_TYPE_LABEL, MODALITY_HELP } from "@/lib/labels";
import { getProcessByCode, type ProcessDetail } from "@/lib/queries/processes";

async function processMeta(code: string) {
  "use cache";
  cacheLife("hours");
  if (!dbConfigured()) return null;
  try {
    const rows = await getSql()<{ title: string | null; institution: string | null; estimated_amount: string | null; currency: string | null }[]>`
      select p.title, i.name as institution, p.estimated_amount::text, p.currency
      from procurement_processes p left join institutions i on i.id = p.institution_id where p.code = ${code}`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata(props: PageProps<"/compras/[id]">): Promise<Metadata> {
  const code = decodeURIComponent((await props.params).id);
  const meta = await processMeta(code);
  if (!meta) return { title: `Compra ${code}`, robots: { index: false } };
  const title = truncate(sentenceCase(meta.title) || code, 90);
  const description = `Compra pública ${code} de ${meta.institution ?? "una institución del Estado"}. Monto estimado: ${formatMoney(meta.estimated_amount, meta.currency)}. Datos oficiales de la DGCP explicados de forma sencilla.`;
  return {
    title,
    description,
    alternates: { canonical: `/compras/${encodeURIComponent(code)}` },
    openGraph: { title, description, type: "article" },
  };
}

export default function ProcessPage(props: PageProps<"/compras/[id]">) {
  return (
    <div className="container-page py-8 md:py-10">
      <Suspense fallback={<Skeleton lines={6} label="Cargando la compra…" />}>
        <ProcessContent params={props.params} />
      </Suspense>
    </div>
  );
}

async function ProcessContent({ params }: { params: PageProps<"/compras/[id]">["params"] }) {
  const code = decodeURIComponent((await params).id);
  await connection();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let detail: ProcessDetail | null;
  try {
    detail = await getProcessByCode(code);
  } catch {
    return <ErrorState />;
  }
  if (!detail) notFound();
  const { process: p, contracts, contractItems, processItems, bids, amendments, payments, alerts, versions, projects } = detail;
  const suppliers = [...new Map(contracts.filter((c) => c.supplier_name).map((c) => [c.supplier_id ?? c.supplier_name, c])).values()];
  const currencies = new Set(contracts.map((c) => c.currency ?? "?"));
  const sameCurrency = currencies.size === 1 && contracts.every((c) => c.amount !== null);
  const contractedTotal = sameCurrency ? contracts.reduce((s, c) => s + Number(c.amount), 0) : null;
  const awardedAt = contracts.map((c) => c.awarded_at).filter(Boolean).sort((a, b) => +new Date(a!) - +new Date(b!))[0] ?? null;
  const contractedAt = contracts.map((c) => c.created_at_source).filter(Boolean).sort((a, b) => +new Date(a!) - +new Date(b!))[0] ?? null;
  const published = alerts.filter((a) => a.status === "publicada");

  const stages: Stage[] = [
    { key: "publicado", label: "Publicado", state: p.published_at ? "done" : "unknown", date: p.published_at },
    {
      key: "ofertas",
      label: "Ofertas recibidas",
      state: bids.total > 0 ? "done" : p.bids_opening_at && new Date(p.bids_opening_at) < new Date() ? "unknown" : "pending",
      date: bids.total > 0 ? (p.bids_opening_at ?? bids.last_at) : p.bids_opening_at,
      note: bids.total > 0 ? `${bids.total} ${bids.total === 1 ? "oferta registrada" : "ofertas registradas"}` : bids.total === 0 && p.bids_opening_at && new Date(p.bids_opening_at) < new Date() ? "Sin ofertas registradas en los datos abiertos" : undefined,
    },
    {
      key: "adjudicado",
      label: "Adjudicado",
      state: awardedAt || p.status === "Proceso adjudicado y celebrado" ? "done" : "pending",
      date: awardedAt ?? (p.status === "Proceso adjudicado y celebrado" ? null : p.estimated_award_at),
      note: !awardedAt && p.status !== "Proceso adjudicado y celebrado" && p.estimated_award_at ? "Fecha estimada" : undefined,
    },
    { key: "contratado", label: "Contratado", state: contracts.length ? "done" : "pending", date: contractedAt ?? (contracts.length ? null : undefined) },
    {
      key: "pagado",
      label: "Pagado",
      state: payments.length ? "done" : "unknown",
      date: payments[0]?.paid_at ?? undefined,
      note: payments.length ? undefined : "Sin evidencia oficial de pago",
    },
  ];
  const title = sentenceCase(p.title) || p.code;
  const officialRef = `${p.code} — ${p.institution_name ?? "Institución sin dato"} — ${p.official_url ?? "https://comunidad.comprasdominicana.gob.do"}`;

  return (
    <article>
      <Breadcrumbs items={[{ href: "/", label: "Inicio" }, { href: "/compras", label: "Compras públicas" }, { label: p.code }]} />
      <p className="eyebrow">Así se realizó esta compra</p>
      <h1 className="mt-1 max-w-4xl text-[1.75rem] font-extrabold md:text-[2.25rem]">{title}</h1>
      {p.description && p.description !== p.title && <p className="mt-3 max-w-3xl text-ink-muted">{truncate(p.description, 500)}</p>}

      <dl className="card mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Código oficial"><Code>{p.code}</Code></Field>
        <Field label="Institución">
          {p.institution_slug ? <Link className="font-bold text-navy underline" href={`/instituciones/${p.institution_slug}`}>{p.institution_name}</Link> : textOr(p.institution_name)}
        </Field>
        <Field label="Fecha de publicación">{formatDate(p.published_at)}</Field>
        <Field label={suppliers.length > 1 ? "Proveedores adjudicados" : "Proveedor adjudicado"}>
          {suppliers.length === 0
            ? contracts.length === 0 ? "Aún no hay contrato registrado" : SIN_DATO
            : suppliers.map((s, i) => (
                <span key={i} className="block">
                  {s.supplier_id ? <Link className="font-bold text-navy underline" href={`/proveedores/${s.supplier_id}`}>{s.supplier_name}</Link> : s.supplier_name}
                </span>
              ))}
        </Field>
        <Field label="Modalidad">
          {textOr(p.modality)}
          {p.exception_type && p.exception_type !== "Proceso ordinario" && <span className="block text-sm text-ink-muted">Excepción: {p.exception_type}</span>}
          {p.modality && MODALITY_HELP[p.modality] && <span className="block text-sm text-ink-muted">{MODALITY_HELP[p.modality]}</span>}
        </Field>
        <Field label="Estado">{textOr(p.status)}</Field>
        <Field label="Tipo de compra">{[p.object_type, p.object_subtype].filter(Boolean).join(" · ") || SIN_DATO}</Field>
        <Field label="Área que lo solicitó">{textOr(p.requesting_area)}</Field>
        {p.snip_code && <Field label="Código SNIP (inversión pública)"><Code>{p.snip_code}</Code></Field>}
      </dl>

      <div className="mt-4 flex flex-wrap items-start gap-3 no-print">
        <ShareButton title={title} text={`Compra pública ${p.code} de ${p.institution_name ?? "una institución del Estado"}. Datos oficiales de la DGCP.`} />
        {p.official_url && (
          <a href={p.official_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            Ver en el portal oficial <span className="sr-only">(abre en otra pestaña)</span>
          </a>
        )}
        <CopyButton value={officialRef} label="Copiar referencia oficial" />
        <a href={`/api/processes/${encodeURIComponent(p.code)}`} className="btn btn-quiet">
          <Download aria-hidden="true" className="size-5" /> Datos (JSON)
        </a>
      </div>

      {published.length > 0 && (
        <div className="mt-6">
          <Notice tone="amber" title="Este proceso tiene alertas del Radar">
            <ul className="mt-1 space-y-1">
              {published.map((a) => (
                <li key={a.public_id}>
                  <Link href={`/radar/${a.public_id}`} className="font-bold text-navy underline">{a.title}</Link>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <section aria-labelledby="linea" className="mt-12">
        <SectionHeading id="linea" title="Línea de tiempo" intro="Cada etapa con su fecha cuando está disponible. «Pagado» solo se marca con evidencia oficial." />
        <StageRail stages={stages} title="Etapas de esta compra" />
      </section>

      <section aria-labelledby="montos" className="mt-12">
        <SectionHeading id="montos" title="Montos" intro="Cada monto corresponde a una etapa distinta. No se suman entre sí." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-5"><Money value={p.estimated_amount} currency={p.currency} type="estimado" /></div>
          <div className="card p-5">
            <Money value={null} currency={p.currency} type="adjudicado" />
            <p className="mt-1 text-sm text-ink-muted">La DGCP no publica un monto de adjudicación separado del contrato.</p>
          </div>
          <div className="card p-5">
            <Money value={contracts.length === 0 ? null : contractedTotal} currency={sameCurrency ? contracts[0]?.currency : null} type="contratado" />
            {contracts.length > 1 && sameCurrency && <p className="mt-1 text-sm text-ink-muted">Suma de {contracts.length} contratos de este proceso, en la misma moneda.</p>}
            {contracts.length > 0 && !sameCurrency && <p className="mt-1 text-sm text-ink-muted">Contratos en monedas distintas o con montos faltantes: ver cada contrato abajo.</p>}
          </div>
          <div className="card p-5">
            <Money value={payments.length ? payments.reduce((s, x) => s + Number(x.amount), 0) : null} currency={payments[0]?.currency ?? "DOP"} type="pagado" />
            {!payments.length && <p className="mt-1 text-sm text-ink-muted">No hay una fuente oficial abierta de pagos para este contrato.</p>}
          </div>
        </div>
        <div className="mt-4">
          <h3 className="text-lg font-bold">Modificaciones</h3>
          {amendments.length === 0 ? (
            <p className="text-ink-muted">No se han registrado enmiendas en los datos abiertos (OCDS) para los contratos de este proceso.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {amendments.map((a) => (
                <li key={a.id} className="border-2 border-ink p-3">
                  <strong>Contrato {a.contract_code}</strong> · {formatDate(a.amended_at)}: {textOr(a.description)} —{" "}
                  de <Fig>{formatMoney(a.amount_before, a.currency)}</Fig> a <Fig tone="red">{formatMoney(a.amount_after, a.currency)}</Fig> (monto modificado)
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="contratos" className="mt-12">
        <SectionHeading id="contratos" title="Contratos" />
        {contracts.length === 0 ? (
          <EmptyState title="Este proceso aún no tiene contratos registrados">
            Si el proceso está abierto o en evaluación, el contrato aparecerá cuando la DGCP lo publique.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {contracts.map((c) => (
              <li key={c.id} id={`contrato-${c.code}`} className="card p-5">
                <p className="eyebrow">Contrato</p>
                <p className="font-bold"><Code>{c.code}</Code></p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Proveedor">{c.supplier_id ? <Link className="font-bold text-navy underline" href={`/proveedores/${c.supplier_id}`}>{c.supplier_name}</Link> : textOr(c.supplier_name)}</Field>
                  <Field label="Estado">{textOr(c.status)}</Field>
                  <Field label="Fecha de adjudicación">{formatDate(c.awarded_at)}</Field>
                  <Field label="Forma de pago">{[...new Set([c.payment_method, c.payment_term].filter(Boolean))].join(" · ") || SIN_DATO}</Field>
                </dl>
                <div className="mt-3"><Money value={c.amount} currency={c.currency} type="contratado" /></div>
                {c.official_url && <p className="mt-3"><ExternalA href={c.official_url}>Ver contrato en el portal oficial</ExternalA></p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="articulos" className="mt-12">
        <SectionHeading
          id="articulos"
          title={contractItems.length ? "Artículos contratados" : "Artículos solicitados"}
          intro={contractItems.length
            ? "El precio unitario de la DGCP es antes de impuestos y descuentos. Total = cantidad × precio + ITBIS y otros impuestos − descuentos."
            : "Lo que la institución pidió al publicar, con precios estimados (no son precios contratados)."}
        />
        {contractItems.length > 0 ? (
          <ContractItems items={contractItems} />
        ) : processItems.length > 0 ? (
          <ProcessItems items={processItems} currency={p.currency} />
        ) : (
          <EmptyState title="No tenemos el detalle de artículos de este proceso">
            Consulta el portal oficial para ver el pliego y las especificaciones.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="documentos" className="mt-12">
        <SectionHeading id="documentos" title="Documentos" intro="Enlazamos siempre al archivo original en el portal de la DGCP." />
        <Documents detail={detail} />
      </section>

      <section aria-labelledby="analisis" className="mt-12">
        <SectionHeading id="analisis" title="Análisis del proceso" />
        {alerts.length === 0 ? (
          <p className="text-ink-muted">El Radar no tiene hallazgos sobre este proceso con la información disponible al {formatDate(new Date())}.</p>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.public_id} className="card flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertLabel label={a.public_label} />
                  <span className="text-sm font-bold text-ink-muted">{ALERT_TYPE_LABEL[a.alert_type] ?? a.alert_type}</span>
                  {a.status !== "publicada" && <span className="text-sm font-bold">({a.status === "retirada" ? "retirada" : "aclarada"})</span>}
                </div>
                <Link href={`/radar/${a.public_id}`} className="font-bold text-navy underline">{a.title}</Link>
                <p className="text-ink-muted">{truncate(a.summary, 220)}</p>
                <p className="text-sm text-ink-muted">Analizada el {formatDate(a.last_evaluated_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {projects.length > 0 && (
        <section aria-labelledby="obras" className="mt-12">
          <SectionHeading id="obras" title="Obra o proyecto de inversión vinculado" />
          <ul className="space-y-2">
            {projects.map((pr) => (
              <li key={pr.id}><Link className="font-bold text-navy underline" href={`/obras/${pr.id}`}>{pr.name}</Link> {pr.snip_code && <span className="text-ink-muted">(SNIP {pr.snip_code})</span>}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="procedencia" className="mt-12">
        <SectionHeading id="procedencia" title="Procedencia de los datos" />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fuente">Dirección General de Contrataciones Públicas (API de datos abiertos)</Field>
          <Field label="Visto por primera vez en nuestro sistema">{formatDateTime(p.first_seen_at)}</Field>
          <Field label="Última verificación">{formatDateTime(p.last_seen_at)}</Field>
          <Field label="Último cambio observado">{p.last_changed_at ? formatDateTime(p.last_changed_at) : "Ninguno desde que lo registramos"}</Field>
        </dl>
        {versions.length > 0 && (
          <details className="mt-4 border-2 border-ink p-4">
            <summary className="flex min-h-12 items-center gap-2 font-bold text-navy"><History aria-hidden="true" className="size-5" /> Cambios observados ({versions.length})</summary>
            <p className="mt-2 text-sm text-ink-muted">Solo registramos cambios ocurridos después de la primera vez que vimos este registro.</p>
            <ul className="mt-3 space-y-2">
              {versions.map((v, i) => (
                <li key={i} className="text-[0.9375rem]">
                  <strong>{formatDateTime(v.observed_at)}</strong> ({v.entity === "process" ? "proceso" : "contrato"}):{" "}
                  {Object.keys(v.changed_fields ?? {}).join(", ")}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </article>
  );
}

const EXPECTED_DOCS = [
  { key: "pliego", label: "Pliego de condiciones o especificaciones", match: /pliego|especificaci|ficha|t[ée]rmino/i },
  { key: "ofertas", label: "Ofertas o actas de apertura", match: /oferta|apertura/i },
  { key: "adjudicacion", label: "Acta o acto de adjudicación", match: /adjudic/i },
  { key: "contrato", label: "Contrato", match: /contrato|orden de compra/i },
  { key: "adendas", label: "Adendas o enmiendas", match: /adenda|enmienda/i },
];

function Documents({ detail }: { detail: ProcessDetail }) {
  const { process: p, documents } = detail;
  if (!p.documents_checked_at) {
    return (
      <div className="card p-5">
        <p>Todavía no hemos consultado la lista de documentos de este proceso.</p>
        {p.official_url && <p className="mt-2"><ExternalA href={p.official_url}>Ver documentos en el portal oficial</ExternalA></p>}
      </div>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div>
        {documents.length === 0 ? (
          <EmptyState title="No encontramos documentos publicados">Consultado el {formatDateTime(p.documents_checked_at)}.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="flex items-start gap-3 border-2 border-ink p-3">
                <FileText aria-hidden="true" className="mt-1 size-5 shrink-0 text-navy" />
                <div className="min-w-0">
                  <ExternalA href={d.url}>{d.name}</ExternalA>
                  <p className="text-sm text-ink-muted">{textOr(d.doc_type)} · Cargado el {formatDate(d.uploaded_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card p-4">
        <p className="font-bold">Documentos esperados</p>
        <ul className="mt-2 space-y-2">
          {EXPECTED_DOCS.map((e) => {
            const found = documents.some((d) => e.match.test(`${d.name} ${d.doc_type ?? ""}`));
            return (
              <li key={e.key} className="flex items-start gap-2">
                {found ? <FileText aria-hidden="true" className="mt-0.5 size-5 text-green" /> : <FileX aria-hidden="true" className="mt-0.5 size-5 text-ink-muted" />}
                <span>{e.label}: <strong>{found ? "disponible" : "no disponible"}</strong></span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-ink-muted">Según el nombre y tipo informados por la DGCP. Algunos documentos pueden no aplicar a esta modalidad.</p>
      </div>
    </div>
  );
}
