import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { AlertLabel, Breadcrumbs, EmptyState, ErrorState, Field, Fig, Notice, SectionHeading, Skeleton } from "@/components/ui";
import { BarList } from "@/components/charts";
import { dbConfigured, getSql } from "@/lib/db";
import { formatDate, formatMoney, formatNumber, sentenceCase, textOr, truncate } from "@/lib/format";
import { ALERT_TYPE_LABEL } from "@/lib/labels";
import { getInstitution } from "@/lib/queries/entities";

async function instMeta(slug: string) {
  "use cache";
  cacheLife("hours");
  if (!dbConfigured()) return null;
  try {
    const r = await getSql()<{ name: string }[]>`select name from institutions where slug = ${slug}`;
    return r[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata(props: PageProps<"/instituciones/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const m = await instMeta(slug);
  return m
    ? { title: m.name, description: `Compras, contratos y proveedores de ${m.name} según datos oficiales de la DGCP.`, alternates: { canonical: `/instituciones/${slug}` } }
    : { title: "Institución", robots: { index: false } };
}

export default function InstitutionPage(props: PageProps<"/instituciones/[slug]">) {
  return (
    <div className="container-page py-8 md:py-10">
      <Suspense fallback={<Skeleton lines={6} label="Cargando la institución…" />}>
        <Content params={props.params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: PageProps<"/instituciones/[slug]">["params"] }) {
  const { slug } = await params;
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  const d = await getInstitution(slug).catch(() => undefined);
  if (d === undefined) return <ErrorState />;
  if (!d) notFound();
  const { institution: i } = d;
  return (
    <article>
      <Breadcrumbs items={[{ href: "/", label: "Inicio" }, { href: "/instituciones", label: "Instituciones" }, { label: i.acronym ?? i.name }]} />
      <p className="eyebrow">Institución pública</p>
      <h1 className="mt-1 text-[1.75rem] font-extrabold md:text-[2.25rem]">{i.name}</h1>
      <dl className="card mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Siglas">{textOr(i.acronym)}</Field>
        <Field label="Tipo de institución">{textOr(i.kind)}</Field>
        <Field label="Código de unidad de compra (DGCP)">{i.source_key}</Field>
        <Field label="Estado en la DGCP">{textOr(i.status)}</Field>
      </dl>
      <div className="mt-4">
        <Notice>
          Estas cifras son de <strong>contratación pública</strong> (DGCP). El presupuesto de la institución es otro universo de datos y se
          consulta en <Link className="font-bold text-navy underline" href="/presupuesto">Presupuesto</Link>; no se mezclan.
        </Notice>
      </div>

      <section aria-labelledby="anual" className="mt-10">
        <SectionHeading id="anual" title="Evolución anual" intro="Montos contratados en pesos dominicanos. Los contratos en otras monedas se cuentan aparte." />
        {d.byYear.length === 0 ? (
          <EmptyState title="Sin compras registradas en el período sincronizado" />
        ) : (
          <div className="card p-5">
            <BarList
              title="Monto contratado por año (DOP)"
              valueLabel="Monto contratado"
              data={d.byYear.map((y) => ({
                label: String(y.year),
                value: y.contracted_dop ? Number(y.contracted_dop) : null,
                display: formatMoney(y.contracted_dop, "DOP", { compact: true }),
                note: `${formatNumber(y.processes)} procesos publicados · ${formatNumber(y.contracts)} contratos${y.contracted_other ? ` (${y.contracted_other} en otra moneda)` : ""}`,
              }))}
            />
          </div>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="categorias" className="card p-5">
          <h2 id="categorias" className="sr-only">Categorías de gasto</h2>
          {d.categories.length ? (
            <BarList
              title="Categorías de compra más importantes"
              caption="Suma de artículos contratados en DOP por familia UNSPSC."
              valueLabel="Monto contratado"
              data={d.categories.map((c) => ({
                label: (c.name ?? c.code ?? "Sin categoría").trim(),
                value: c.contracted_dop ? Number(c.contracted_dop) : null,
                display: formatMoney(c.contracted_dop, "DOP", { compact: true }),
                href: c.code ? `/buscar?institucion=${i.id}&familia=${c.code}` : undefined,
              }))}
            />
          ) : (
            <p>Sin detalle de categorías.</p>
          )}
        </section>
        <section aria-labelledby="prov" className="card p-5">
          <h2 id="prov" className="sr-only">Proveedores</h2>
          {d.suppliers.length ? (
            <BarList
              title="Proveedores con más monto contratado"
              caption="Concentración no implica irregularidad."
              valueLabel="Monto contratado"
              data={d.suppliers.map((s) => ({
                label: s.name,
                value: s.contracted_dop ? Number(s.contracted_dop) : null,
                display: `${formatMoney(s.contracted_dop, "DOP", { compact: true })} · ${formatNumber(s.contracts)} contratos`,
                href: `/proveedores/${s.id}`,
              }))}
            />
          ) : (
            <p>Sin proveedores registrados.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="recientes" className="mt-10">
        <SectionHeading id="recientes" title="Compras recientes" />
        {d.recent.length === 0 && <EmptyState title="Sin compras recientes" />}
        <ul className="mt-4 space-y-2">
          {d.recent.map((r) => (
            <li key={r.code}>
              <Link href={`/compras/${encodeURIComponent(r.code)}`} className="font-bold text-navy underline">{truncate(sentenceCase(r.title) || r.code, 110)}</Link>{" "}
              <span className="text-ink-muted">· {formatDate(r.published_at)} · <Fig>{formatMoney(r.estimated_amount, r.currency)}</Fig> (estimado)</span>
            </li>
          ))}
        </ul>
        <p className="mt-4"><Link className="btn btn-secondary" href={`/buscar?institucion=${i.id}&orden=fecha`}>Ver todas sus compras</Link></p>
      </section>

      <section aria-labelledby="alertas" className="mt-10">
        <SectionHeading id="alertas" title="Alertas asociadas a sus procesos" />
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
          <p className="text-ink-muted">No hay alertas publicadas para los procesos de esta institución.</p>
        )}
      </section>

      <section aria-labelledby="fuentes" className="mt-10 text-[0.9375rem] text-ink-muted">
        <h2 id="fuentes" className="text-lg font-bold text-navy-deep">Fuentes oficiales</h2>
        <p>Dirección General de Contrataciones Públicas: unidades de compra, procesos y contratos (API de datos abiertos). Última verificación: {formatDate(i.last_seen_at)}.</p>
      </section>
    </article>
  );
}
