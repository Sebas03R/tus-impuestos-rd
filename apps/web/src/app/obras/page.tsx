import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { ProvinceMap } from "@/components/province-map";
import { EmptyState, ErrorState, Money, PageHeader, Pagination, SectionHeading, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDate, formatNumber, sentenceCase, SIN_DATO, textOr, truncate } from "@/lib/format";
import { flattenParams, toQuery } from "@/lib/queries/filters";
import { listProjects, projectFacets } from "@/lib/queries/fiscal";

export const metadata: Metadata = {
  title: "Obras y proyectos de inversión pública",
  description: "Proyectos de inversión pública por provincia, municipio, institución y estado, con datos de MapaInversiones.",
  alternates: { canonical: "/obras" },
};

export default function ObrasPage(props: PageProps<"/obras">) {
  return (
    <>
      <PageHeader
        eyebrow="Fuente: MapaInversiones"
        title="¿Qué obras se construyen cerca de mí?"
        intro={<p>Proyectos de inversión pública con su ubicación, institución responsable, presupuesto y avance, según los datos oficiales publicados. No inventamos coordenadas ni porcentajes.</p>}
      />
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={6} label="Cargando obras…" />}>
          <Content searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/obras">["searchParams"] }) {
  const raw = flattenParams(await searchParams);
  const f = {
    provincia: raw.provincia?.slice(0, 80) || undefined,
    municipio: raw.municipio?.slice(0, 120) || undefined,
    institucion: raw.institucion?.slice(0, 200) || undefined,
    estado: raw.estado?.slice(0, 80) || undefined,
    sector: raw.sector?.slice(0, 120) || undefined,
    anio: /^\d{4}$/.test(raw.anio ?? "") ? Number(raw.anio) : undefined,
    q: raw.q?.slice(0, 120) || undefined,
  };
  const page = Math.max(1, Math.min(1000, Number.parseInt(raw.pagina ?? "1", 10) || 1));
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let data, facets;
  try {
    [data, facets] = await Promise.all([listProjects({ ...f, page }), projectFacets(f.provincia)]);
  } catch {
    return <ErrorState />;
  }
  if (facets.provinces.length === 0 && data.total === 0) {
    return (
      <EmptyState title="Todavía no hemos cargado proyectos de inversión">
        La sincronización diaria con MapaInversiones traerá proyectos, ubicaciones y contratos asociados.
      </EmptyState>
    );
  }
  await connection(); // el año actual depende de la fecha de la visita, no del prerender
  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i);
  return (
    <div className="grid gap-10">
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div className="card p-4">
          <ProvinceMap counts={facets.provinces} selected={f.provincia} hrefFor={(p) => `/obras${toQuery({ provincia: p })}#listado`} />
        </div>
        <form action="/obras" method="get" className="card space-y-4 p-4" aria-labelledby="filtros-obras">
          <h2 id="filtros-obras" className="text-lg font-bold">Filtrar obras</h2>
          <div>
            <label className="label" htmlFor="o-q">Nombre de la obra</label>
            <input id="o-q" name="q" defaultValue={f.q} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="o-prov">Provincia</label>
            <select id="o-prov" name="provincia" defaultValue={f.provincia ?? ""} className="field">
              <option value="">Todas</option>
              {facets.provinces.map((p) => <option key={p.province} value={p.province}>{sentenceCase(p.province)} ({formatNumber(p.n)})</option>)}
            </select>
          </div>
          {facets.municipalities.length > 0 && (
            <div>
              <label className="label" htmlFor="o-mun">Municipio</label>
              <select id="o-mun" name="municipio" defaultValue={f.municipio ?? ""} className="field">
                <option value="">Todos</option>
                {facets.municipalities.map((m) => <option key={m.value} value={m.value}>{m.value} ({formatNumber(m.n)})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="o-inst">Institución responsable</label>
            <select id="o-inst" name="institucion" defaultValue={f.institucion ?? ""} className="field">
              <option value="">Todas</option>
              {facets.entities.map((e) => <option key={e.value} value={e.value}>{e.value}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <label className="label" htmlFor="o-sec">Tipo de obra (sector)</label>
              <select id="o-sec" name="sector" defaultValue={f.sector ?? ""} className="field">
                <option value="">Todos</option>
                {facets.sectors.map((e) => <option key={e.value} value={e.value}>{e.value}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="o-est">Estado</label>
              <select id="o-est" name="estado" defaultValue={f.estado ?? ""} className="field">
                <option value="">Todos</option>
                {facets.statuses.map((e) => <option key={e.value} value={e.value}>{sentenceCase(e.value)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="o-anio">Año de inicio</label>
            <select id="o-anio" name="anio" defaultValue={f.anio ?? ""} className="field">
              <option value="">Todos</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" type="submit">Aplicar filtros</button>
            <Link className="btn btn-quiet" href="/obras">Quitar filtros</Link>
          </div>
        </form>
      </div>

      <section aria-labelledby="listado" id="listado">
        <SectionHeading id="listado-titulo" title={`${formatNumber(data.total)} proyectos${f.provincia ? ` en ${sentenceCase(f.provincia)}` : ""}`} intro={facets.national ? `${formatNumber(facets.national)} proyectos son de alcance nacional y no aparecen en el mapa.` : undefined} />
        {data.rows.length === 0 ? (
          <EmptyState title="No hay proyectos con estos filtros" />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {data.rows.map((p) => (
              <li key={p.id} className="card flex flex-col gap-3 p-5">
                <p className="text-sm font-bold text-ink-muted">{[p.sector, p.status && sentenceCase(p.status)].filter(Boolean).join(" · ")}</p>
                <h3 className="text-lg font-bold leading-snug">
                  <Link href={`/obras/${p.id}`} className="text-navy-deep underline-offset-4 hover:underline">{truncate(sentenceCase(p.name), 150)}</Link>
                </h3>
                <dl className="grid gap-1 text-[0.9375rem]">
                  <div className="flex gap-1.5"><dt className="font-bold">Ubicación:</dt><dd>{p.provinces ? sentenceCase(p.provinces) : "Nacional o sin dato"}</dd></div>
                  <div className="flex gap-1.5"><dt className="font-bold">Responsable:</dt><dd>{textOr(p.executing_entity)}</dd></div>
                  <div className="flex gap-1.5"><dt className="font-bold">Fechas previstas:</dt><dd>{formatDate(p.start_date, "short")} – {formatDate(p.end_date, "short")}</dd></div>
                  <div className="flex gap-1.5"><dt className="font-bold">Avance físico:</dt><dd>{p.physical_progress_pct === null ? SIN_DATO : `${formatNumber(p.physical_progress_pct, 1)} %`}</dd></div>
                </dl>
                <Money value={p.project_value} currency={p.currency} type="presupuesto" size="sm" />
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} pages={data.pages} hrefFor={(n) => `/obras${toQuery({ ...f, pagina: n })}#listado`} />
      </section>

      <section aria-labelledby="lista-provincias" id="lista-provincias">
        <SectionHeading id="lista-provincias-t" title="Proyectos por provincia (lista)" />
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {facets.provinces.map((p) => (
            <li key={p.province}>
              <Link className="flex min-h-12 items-center justify-between border-2 border-ink px-3 font-bold text-navy no-underline hover:bg-sky" href={`/obras${toQuery({ provincia: p.province })}#listado`}>
                {sentenceCase(p.province)} <span className="tabular text-ink-muted">{formatNumber(p.n)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
