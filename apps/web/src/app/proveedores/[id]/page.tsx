import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { BarList } from "@/components/charts";
import { AlertLabel, Breadcrumbs, Code, EmptyState, ErrorState, Field, Fig, Notice, SectionHeading, Skeleton } from "@/components/ui";
import { dbConfigured, getSql } from "@/lib/db";
import { formatDate, formatMoney, formatNumber, sentenceCase, textOr, truncate } from "@/lib/format";
import { ALERT_TYPE_LABEL } from "@/lib/labels";
import { getSupplier } from "@/lib/queries/entities";

async function supMeta(id: number) {
  "use cache";
  cacheLife("hours");
  if (!dbConfigured()) return null;
  try {
    const r = await getSql()<{ name: string }[]>`select name from suppliers where id = ${id}`;
    return r[0] ?? null;
  } catch {
    return null;
  }
}

function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata(props: PageProps<"/proveedores/[id]">): Promise<Metadata> {
  const id = parseId((await props.params).id);
  const m = id ? await supMeta(id) : null;
  return m
    ? { title: m.name, description: `Contratos de ${m.name} con el Estado dominicano según la DGCP.`, alternates: { canonical: `/proveedores/${id}` } }
    : { title: "Proveedor", robots: { index: false } };
}

export default function SupplierPage(props: PageProps<"/proveedores/[id]">) {
  return (
    <div className="container-page py-8 md:py-10">
      <Suspense fallback={<Skeleton lines={6} label="Cargando el proveedor…" />}>
        <Content params={props.params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: PageProps<"/proveedores/[id]">["params"] }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  const d = await getSupplier(id).catch(() => undefined);
  if (d === undefined) return <ErrorState />;
  if (!d) notFound();
  const s = d.supplier;
  return (
    <article>
      <Breadcrumbs items={[{ href: "/", label: "Inicio" }, { href: "/proveedores", label: "Proveedores" }, { label: s.name }]} />
      <p className="eyebrow">Proveedor del Estado</p>
      <h1 className="mt-1 text-[1.75rem] font-extrabold md:text-[2.25rem]">{s.name}</h1>
      <dl className="card mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Registro de Proveedores del Estado (RPE)"><Code>{s.rpe}</Code></Field>
        <Field label="RNC">{s.rnc ? <Code>{s.rnc}</Code> : s.person_type?.toLowerCase().includes("física") ? "No se publica (persona física)" : textOr(s.rnc)}</Field>
        <Field label="Tipo">{[s.person_type, s.legal_form].filter(Boolean).join(" · ") || textOr(null)}</Field>
        <Field label="Estado en el RPE">{textOr(s.status)}</Field>
        <Field label="Provee">{textOr(s.supplies)}</Field>
        <Field label="Ubicación">{[s.municipality, s.province].filter(Boolean).join(", ") || textOr(null)}</Field>
        <Field label="MIPYME">{s.is_mipyme === null ? textOr(null) : s.is_mipyme ? "Sí" : "No"}</Field>
        <Field label="Registrado desde">{formatDate(s.registered_at)}</Field>
      </dl>
      <div className="mt-4">
        <Notice>
          Mostramos solo datos públicos pertinentes del registro de proveedores. No publicamos teléfonos, correos ni datos de contacto.
          Las relaciones entre proveedores e instituciones son contratos registrados, no implican vínculos indebidos.
        </Notice>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section className="card p-5" aria-label="Montos por año">
          {d.byYear.length ? (
            <BarList
              title="Monto contratado por año (DOP)"
              valueLabel="Monto contratado"
              data={d.byYear.map((y) => ({
                label: String(y.year),
                value: y.contracted_dop ? Number(y.contracted_dop) : null,
                display: formatMoney(y.contracted_dop, "DOP", { compact: true }),
                note: `${formatNumber(y.contracts)} contratos${y.contracted_other ? ` (${y.contracted_other} en otra moneda)` : ""}`,
              }))}
            />
          ) : (
            <p>Sin contratos en el período sincronizado.</p>
          )}
        </section>
        <section className="card p-5" aria-label="Instituciones contratantes">
          {d.institutions.length ? (
            <BarList
              title="Instituciones contratantes"
              valueLabel="Contratos"
              data={d.institutions.map((i) => ({
                label: i.name,
                value: i.contracts,
                display: `${formatNumber(i.contracts)} contratos · ${formatMoney(i.contracted_dop, "DOP", { compact: true })}`,
                href: `/instituciones/${i.slug}`,
              }))}
            />
          ) : (
            <p>Sin instituciones registradas.</p>
          )}
        </section>
      </div>

      {d.categories.length > 0 && (
        <section aria-labelledby="cat" className="mt-10">
          <SectionHeading id="cat" title="Categorías de suministros" />
          <ul className="flex flex-wrap gap-2">
            {d.categories.map((c) => (
              <li key={c.code ?? "x"} className="rounded-full border-2 border-ink px-3 py-1">{(c.name ?? c.code ?? "Sin categoría").trim()} · {formatNumber(c.contracts)}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="contratos" className="mt-10">
        <SectionHeading id="contratos" title="Contratos registrados" intro="Los 25 más recientes." />
        {d.contracts.length === 0 ? (
          <EmptyState title="Sin contratos registrados" />
        ) : (
          <ul className="space-y-3">
            {d.contracts.map((c) => (
              <li key={c.code} className="border-2 border-ink p-4">
                <Link href={c.has_process && c.process_code ? `/compras/${encodeURIComponent(c.process_code)}` : `/contratos/${encodeURIComponent(c.code)}`} className="font-bold text-navy underline">
                  {truncate(sentenceCase(c.description) || c.code, 120)}
                </Link>
                <p className="text-[0.9375rem] text-ink-muted">
                  {textOr(c.institution_name)} · {formatDate(c.awarded_at)} · <Fig>{formatMoney(c.amount, c.currency)}</Fig> (monto contratado) · <Code>{c.code}</Code>
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4"><Link className="btn btn-secondary" href={`/buscar?proveedor=${s.id}&tipo=contrato&orden=fecha`}>Ver todos sus contratos</Link></p>
      </section>

      <section aria-labelledby="alertas" className="mt-10">
        <SectionHeading id="alertas" title="Alertas documentadas vinculadas a sus contratos" />
        {d.alerts.length ? (
          <ul className="space-y-2">
            {d.alerts.map((a) => (
              <li key={a.public_id} className="flex flex-wrap items-center gap-2">
                <AlertLabel label={a.public_label} />
                <span className="text-sm text-ink-muted">{ALERT_TYPE_LABEL[a.alert_type]}</span>
                <Link className="font-bold text-navy underline" href={`/radar/${a.public_id}`}>{a.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">No hay alertas publicadas vinculadas a contratos de este proveedor.</p>
        )}
      </section>
      <p className="mt-10 text-sm text-ink-muted">Fuente: DGCP, Registro de Proveedores del Estado. Última verificación: {formatDate(s.last_seen_at)}.</p>
    </article>
  );
}
