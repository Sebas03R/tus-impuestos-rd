import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { Breadcrumbs, Code, ErrorState, ExternalA, Field, Fig, Money, Notice, SectionHeading, Skeleton } from "@/components/ui";
import { DataTable } from "@/components/charts";
import { dbConfigured, getSql } from "@/lib/db";
import { formatDate, formatMoney, formatNumber, sentenceCase, SIN_DATO, textOr } from "@/lib/format";
import { getProject } from "@/lib/queries/fiscal";

async function projMeta(id: number) {
  "use cache";
  cacheLife("hours");
  if (!dbConfigured()) return null;
  try {
    const r = await getSql()<{ name: string }[]>`select name from investment_projects where id = ${id}`;
    return r[0] ?? null;
  } catch {
    return null;
  }
}

const parseId = (raw: string) => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

export async function generateMetadata(props: PageProps<"/obras/[id]">): Promise<Metadata> {
  const id = parseId((await props.params).id);
  const m = id ? await projMeta(id) : null;
  return m ? { title: sentenceCase(m.name), alternates: { canonical: `/obras/${id}` } } : { title: "Obra", robots: { index: false } };
}

export default function ProjectPage(props: PageProps<"/obras/[id]">) {
  return (
    <div className="container-page py-8 md:py-10">
      <Suspense fallback={<Skeleton lines={6} label="Cargando la obra…" />}>
        <Content params={props.params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: PageProps<"/obras/[id]">["params"] }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  const d = await getProject(id).catch(() => undefined);
  if (d === undefined) return <ErrorState />;
  if (!d) notFound();
  const p = d.project;
  const provinces = d.locations.filter((l) => !l.is_national);
  return (
    <article>
      <Breadcrumbs items={[{ href: "/", label: "Inicio" }, { href: "/obras", label: "Obras" }, { label: p.snip_code ? `SNIP ${p.snip_code}` : "Proyecto" }]} />
      <p className="eyebrow">Proyecto de inversión pública</p>
      <h1 className="mt-1 text-[1.75rem] font-extrabold md:text-[2.25rem]">{sentenceCase(p.name)}</h1>
      <dl className="card mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Código SNIP">{p.snip_code ? <Code>{p.snip_code}</Code> : SIN_DATO}</Field>
        <Field label="Institución responsable">{textOr(p.executing_entity)}</Field>
        <Field label="Estado">{p.status ? sentenceCase(p.status) : SIN_DATO}</Field>
        <Field label="Sector">{textOr(p.sector)}</Field>
        <Field label="Tipo de proyecto">{textOr(p.project_type)}</Field>
        <Field label="Fechas previstas">{formatDate(p.start_date)} – {formatDate(p.end_date)}</Field>
        <Field label="Ubicación">
          {provinces.length
            ? [...new Set(provinces.map((l) => [l.municipality, l.province].filter(Boolean).join(", ")))].slice(0, 12).join(" · ")
            : d.locations.some((l) => l.is_national) ? "Alcance nacional" : SIN_DATO}
        </Field>
        <Field label="Ejecución física">{p.physical_progress_pct === null ? SIN_DATO : `${formatNumber(p.physical_progress_pct, 1)} %`}</Field>
        <Field label="Ejecución financiera">{p.financial_progress_pct === null ? SIN_DATO : `${formatNumber(p.financial_progress_pct, 1)} %`}</Field>
      </dl>
      <div className="card mt-4 inline-block max-w-full p-5"><Money value={p.project_value} currency={p.currency} type="presupuesto" size="lg" /></div>
      {p.objective && (
        <section aria-labelledby="obj" className="mt-10">
          <SectionHeading id="obj" title="Objetivo" />
          <p className="max-w-3xl whitespace-pre-line">{p.objective}</p>
        </section>
      )}

      <section aria-labelledby="presu" className="mt-10">
        <SectionHeading id="presu" title="Presupuesto del proyecto por año" intro="Presupuesto de inversión publicado por Hacienda en MapaInversiones (mismo código SNIP)." />
        {d.budget.length ? (
          <DataTable caption="Presupuesto por año" columns={["Año", "Aprobado", "Vigente", "Ejecutado"]} rows={d.budget.map((b) => [String(b.year), formatMoney(b.approved, "DOP"), formatMoney(b.current, "DOP"), formatMoney(b.accrued, "DOP")])} />
        ) : (
          <p className="text-ink-muted">Sin registros presupuestarios con este código SNIP.</p>
        )}
      </section>

      <section aria-labelledby="contratos" className="mt-10">
        <SectionHeading id="contratos" title="Procesos y contratos asociados" intro="Vínculos publicados por MapaInversiones. Cada monto es el contratado del registro enlazado." />
        {d.links.length === 0 ? (
          <p className="text-ink-muted">No hay contratos asociados publicados.</p>
        ) : (
          <ul className="space-y-2">
            {d.links.map((l, i) => (
              <li key={i} className="border-2 border-ink p-3 text-[0.9375rem]">
                <p className="font-bold">{textOr(l.description, l.contract_code ?? l.process_code ?? "Registro")}</p>
                <p className="text-ink-muted">
                  {l.supplier_name && `${l.supplier_name} · `}
                  {l.amount ? <><Fig>{formatMoney(l.amount, l.currency)}</Fig> (contratado)</> : ""}
                </p>
                <p className="flex flex-wrap gap-3">
                  {l.process_code && (l.in_db ? <Link className="font-bold text-navy underline" href={`/compras/${encodeURIComponent(l.process_code)}`}>Proceso <Code>{l.process_code}</Code></Link> : <span>Proceso <Code>{l.process_code}</Code> (fuera del período sincronizado)</span>)}
                  {l.contract_code && <Link className="font-bold text-navy underline" href={`/contratos/${encodeURIComponent(l.contract_code)}`}>Contrato <Code>{l.contract_code}</Code></Link>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="mt-10">
        <Notice>
          Fuente: {textOr(p.source_name, "MapaInversiones")}. Corte de la fuente: {formatDate(p.source_cut_at)}.{" "}
          <ExternalA href="https://mapainversiones.gob.do/">Ver en MapaInversiones</ExternalA>
        </Notice>
      </div>
    </article>
  );
}
