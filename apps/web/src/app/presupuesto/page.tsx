import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { BarList, DataTable } from "@/components/charts";
import { EmptyState, ErrorState, Notice, PageHeader, Pill, SectionHeading, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { flattenParams, toQuery } from "@/lib/queries/filters";
import { BUDGET_UNIVERSES, getBudgetBreakdown, getBudgetSummary, type BudgetYearRow } from "@/lib/queries/fiscal";

export const metadata: Metadata = {
  title: "Presupuesto público",
  description: "Cuánto se ha presupuestado, en qué se distribuye y cuánto se ha ejecutado, con explicaciones sencillas y fuentes oficiales.",
  alternates: { canonical: "/presupuesto" },
};

export default function BudgetPage(props: PageProps<"/presupuesto">) {
  return (
    <>
      <PageHeader
        eyebrow="Finanzas públicas"
        title="¿Cuánto está gastando el Gobierno?"
        intro={<p>El presupuesto dice cuánto se <em>puede</em> gastar. La ejecución dice cuánto se comprometió o devengó. Son cosas distintas.</p>}
      >
        <ul className="mt-6 grid gap-3 md:grid-cols-3">
          <li className="bg-white p-4 font-bold text-navy-deep shadow-[var(--shadow-card)]">Presupuestado no significa gastado.</li>
          <li className="bg-white p-4 font-bold text-navy-deep shadow-[var(--shadow-card)]">Contratado no significa pagado.</li>
          <li className="bg-white p-4 font-bold text-navy-deep shadow-[var(--shadow-card)]">Devengado no significa necesariamente desembolsado.</li>
        </ul>
      </PageHeader>
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={6} label="Cargando presupuesto…" />}>
          <Budget searchParams={props.searchParams} />
        </Suspense>
        <section aria-labelledby="glosario-p" className="mt-14">
          <SectionHeading id="glosario-p" title="Palabras que conviene conocer" />
          <dl className="grid gap-4 md:grid-cols-2">
            {[
              ["Presupuesto aprobado (inicial)", "Lo que autorizó el Congreso en la Ley de Presupuesto al inicio del año."],
              ["Presupuesto vigente", "El aprobado más las modificaciones hechas durante el año."],
              ["Devengado o ejecutado", "Gasto reconocido: el bien o servicio se recibió y nació la obligación de pagar."],
              ["Pagado", "Dinero efectivamente transferido. Puede ocurrir después del devengado."],
            ].map(([t, d]) => (
              <div key={t} className="card p-4">
                <dt className="font-bold">{t}</dt>
                <dd className="text-ink-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}

async function Budget({ searchParams }: { searchParams: PageProps<"/presupuesto">["searchParams"] }) {
  const raw = flattenParams(await searchParams);
  await connection();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let summary: BudgetYearRow[];
  try {
    summary = await getBudgetSummary();
  } catch {
    return <ErrorState />;
  }
  const blocked = (
    <Notice tone="amber" title="El presupuesto general completo no está disponible todavía">
      La API del Portal de Transparencia Fiscal exige un acceso que no está abierto al público (responde «no autorizado»).
      Mientras tanto mostramos universos parciales con su fuente, sin mezclarlos. Ver{" "}
      <Link href="/fuentes" className="font-bold text-navy underline">estado de las fuentes</Link>.
    </Notice>
  );
  if (summary.length === 0) {
    return (
      <div className="space-y-6">
        {blocked}
        <EmptyState title="Todavía no hemos cargado datos presupuestarios">
          La sincronización con MapaInversiones (presupuesto de inversión) y con las series de Hacienda en datos.gob.do se ejecuta
          diariamente. Cuando termine la primera carga, aquí verás cuánto se presupuestó y ejecutó por año, sector e institución.
        </EmptyState>
      </div>
    );
  }
  const universes = [...new Set(summary.map((r) => r.universe))];
  const universe = universes.includes(raw.universo) ? raw.universo : universes.includes("inversion_mapainversiones") ? "inversion_mapainversiones" : universes[0];
  const sections = [...new Set(summary.filter((r) => r.universe === universe).map((r) => r.section))];
  const section = sections.includes(raw.seccion ?? null) ? (raw.seccion ?? null) : sections[0];
  const rows = summary.filter((r) => r.universe === universe && r.section === section);
  const years = rows.map((r) => r.year);
  const year = years.includes(Number(raw.anio)) ? Number(raw.anio) : years[0];
  const current = rows.find((r) => r.year === year)!;
  const info = BUDGET_UNIVERSES[universe] ?? { title: universe, description: "", source: universe, by: ["institution" as const] };
  const DIM_TITLE = {
    sector: universe === "ejecucion_hacienda_funcion" ? "¿Para qué se gasta? Por finalidad" : "¿En qué se distribuye? Por sector",
    institution: "Por institución",
    function: "Por función",
    funding: "¿De dónde viene el dinero? Fuente de financiamiento",
  } as const;
  let breakdowns;
  try {
    breakdowns = await Promise.all(info.by.map((dim) => getBudgetBreakdown(universe, section, year, dim).then((data) => ({ dim, data }))));
  } catch {
    return <ErrorState />;
  }
  const execRate = current.current && current.accrued ? (Number(current.accrued) / Number(current.current)) * 100 : null;

  return (
    <div className="space-y-12">
      {blocked}
      <form action="/presupuesto" method="get" className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
        <div className="flex-1">
          <label className="label" htmlFor="b-u">Universo de datos</label>
          <select id="b-u" name="universo" defaultValue={universe} className="field">
            {universes.map((u) => <option key={u} value={u}>{BUDGET_UNIVERSES[u]?.title ?? u}</option>)}
          </select>
        </div>
        {sections.length > 1 && (
          <div className="flex-1">
            <label className="label" htmlFor="b-s">Sección del sector público</label>
            <select id="b-s" name="seccion" defaultValue={section ?? ""} className="field">
              {sections.map((x) => <option key={x ?? "-"} value={x ?? ""}>{x ?? "Todas"}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="b-a">Año</label>
          <select id="b-a" name="anio" defaultValue={year} className="field">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Ver</button>
      </form>

      <section aria-labelledby="universo">
        <SectionHeading id="universo" title={`${info.title}, ${year}`} intro={info.description} />
        {section && <p className="mb-3 font-bold">Sección: {section}. Las secciones no se suman entre sí.</p>}
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Presupuesto aprobado", current.approved],
            ["Presupuesto vigente", current.current],
            ["Devengado / ejecutado", current.accrued],
            ["Pagado", current.paid],
          ].map(([label, value]) => (
            <div key={label as string} className="card p-5">
              <dt className="eyebrow">{label}</dt>
              <dd className="mt-2"><span className="fig whitespace-normal text-[1.875rem] leading-[1.05] min-[420px]:text-[2.25rem]">{formatMoney(value, "DOP", { compact: true })}</span></dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-ink-muted">
          {execRate !== null ? `Se ha ejecutado el ${formatNumber(execRate, 1)} % del presupuesto vigente de este universo. ` : ""}
          Fuente: {info.source}.{current.source_updated_at ? ` Corte de la fuente: ${formatDate(current.source_updated_at)}.` : ""} {formatNumber(current.records)} registros.
          {current.paid === null && " El monto pagado no está disponible en fuentes abiertas: «Sin dato»."}
        </p>
        {current.approximate && (
          <p className="mt-2"><Pill tone="amber">Cifra aproximada en la fuente</Pill> <span className="text-sm text-ink-muted">La fuente publicó algunos montos en notación científica (6 cifras significativas).</span></p>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {breakdowns.map(({ dim, data }) => (
          <section key={dim} className={`card p-5 ${breakdowns.length === 1 ? "lg:col-span-2" : ""}`} aria-label={DIM_TITLE[dim]}>
            {data.filter((r) => r.label).length === 0 ? (
              <p>Sin datos para esta clasificación.</p>
            ) : (
              <BarList
                title={DIM_TITLE[dim]}
                caption="Presupuesto vigente (DOP), clasificación original de la fuente."
                valueLabel="Vigente"
                data={data.filter((r) => r.label).map((r) => ({
                  label: r.label!,
                  value: r.current ? Number(r.current) : null,
                  display: `${formatMoney(r.current, "DOP", { compact: true })} vigente · ${formatMoney(r.accrued, "DOP", { compact: true })} ejecutado${r.approximate ? " (aprox.)" : ""}`,
                }))}
              />
            )}
          </section>
        ))}
      </div>

      <section aria-labelledby="anual">
        <SectionHeading id="anual" title="Comparación anual" intro="Solo dentro del mismo universo de datos." />
        <DataTable
          caption="Comparación anual del presupuesto"
          columns={["Año", "Aprobado", "Vigente", "Ejecutado", "Pagado"]}
          rows={rows.map((r) => [String(r.year), formatMoney(r.approved, "DOP"), formatMoney(r.current, "DOP"), formatMoney(r.accrued, "DOP"), formatMoney(r.paid, "DOP")])}
        />
        <ul className="mt-3 flex flex-wrap gap-2">
          {years.map((y) => (
            <li key={y}><Link className="inline-flex min-h-12 items-center rounded-full border-2 border-ink px-4 font-bold text-navy no-underline hover:bg-sky" href={`/presupuesto${toQuery({ universo: universe, seccion: section ?? undefined, anio: y })}`}>{y}</Link></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
