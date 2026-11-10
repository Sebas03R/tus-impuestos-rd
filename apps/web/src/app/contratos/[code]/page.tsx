import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ContractItems } from "@/components/items";
import { Breadcrumbs, Code, EmptyState, ErrorState, ExternalA, Field, Money, Notice, SectionHeading, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDate, formatDateTime, sentenceCase, SIN_DATO, textOr } from "@/lib/format";
import { getContractByCode, getContractProcessCode } from "@/lib/queries/processes";

export async function generateMetadata(props: PageProps<"/contratos/[code]">): Promise<Metadata> {
  const code = decodeURIComponent((await props.params).code);
  return { title: `Contrato ${code}`, alternates: { canonical: `/contratos/${encodeURIComponent(code)}` } };
}

export default function ContractPage(props: PageProps<"/contratos/[code]">) {
  return (
    <div className="container-page py-8 md:py-10">
      <Suspense fallback={<Skeleton lines={5} label="Cargando el contrato…" />}>
        <ContractContent params={props.params} />
      </Suspense>
    </div>
  );
}

async function ContractContent({ params }: { params: PageProps<"/contratos/[code]">["params"] }) {
  const code = decodeURIComponent((await params).code);
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let link;
  try {
    link = await getContractProcessCode(code);
  } catch {
    return <ErrorState />;
  }
  if (!link.exists) notFound();
  if (link.process_code) redirect(`/compras/${encodeURIComponent(link.process_code)}#contrato-${encodeURIComponent(code)}`);
  const c = await getContractByCode(code);
  if (!c) notFound();
  return (
    <article>
      <Breadcrumbs items={[{ href: "/", label: "Inicio" }, { href: "/compras", label: "Compras públicas" }, { label: c.code }]} />
      <p className="eyebrow">Contrato</p>
      <h1 className="mt-1 text-[1.75rem] font-extrabold md:text-[2.25rem]">{sentenceCase(c.description) || c.code}</h1>
      <div className="mt-4">
        <Notice>
          El proceso de compra de este contrato ({c.process_code ? <Code>{c.process_code}</Code> : "código sin dato"}) todavía no
          está en nuestra base, porque se publicó antes del período que sincronizamos.
        </Notice>
      </div>
      <dl className="card mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Código oficial"><Code>{c.code}</Code></Field>
        <Field label="Institución">{c.institution_slug ? <Link className="font-bold text-navy underline" href={`/instituciones/${c.institution_slug}`}>{c.institution_name}</Link> : textOr(c.institution_name)}</Field>
        <Field label="Proveedor">{c.supplier_id ? <Link className="font-bold text-navy underline" href={`/proveedores/${c.supplier_id}`}>{c.supplier_name}</Link> : textOr(c.supplier_name)}</Field>
        <Field label="Fecha de adjudicación">{formatDate(c.awarded_at)}</Field>
        <Field label="Estado">{textOr(c.status)}</Field>
        <Field label="Forma de pago">{[...new Set([c.payment_method, c.payment_term].filter(Boolean))].join(" · ") || SIN_DATO}</Field>
      </dl>
      <div className="mt-4 card p-5"><Money value={c.amount} currency={c.currency} type="contratado" size="lg" /></div>
      {c.official_url && <p className="mt-4"><ExternalA href={c.official_url}>Ver contrato en el portal oficial</ExternalA></p>}
      <section aria-labelledby="art" className="mt-10">
        <SectionHeading id="art" title="Artículos contratados" intro="Precio unitario antes de impuestos y descuentos." />
        {c.items.length ? <ContractItems items={c.items} /> : <EmptyState title="Sin detalle de artículos" />}
      </section>
      <p className="mt-8 text-sm text-ink-muted">Fuente: DGCP. Visto por primera vez el {formatDateTime(c.first_seen_at)}.</p>
    </article>
  );
}
