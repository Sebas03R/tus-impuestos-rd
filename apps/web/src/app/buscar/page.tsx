import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, SlidersHorizontal, X } from "lucide-react";
import { DataFreshness } from "@/components/data-status";
import { AskBox } from "@/components/ask-box";
import { ResultCard } from "@/components/result-card";
import { aiEnabled } from "@/lib/ai/provider";
import { SearchBox } from "@/components/search-box";
import { EmptyState, ErrorState, Notice, Pagination, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/format";
import { ENTITY_TYPE_LABEL } from "@/lib/labels";
import { institutionOptions, supplierName } from "@/lib/queries/entities";
import { parseSearch, toQuery, type SearchParams } from "@/lib/queries/filters";
import { search, searchFacets } from "@/lib/queries/search";

export const metadata: Metadata = {
  title: "Buscar compras, contratos, instituciones y proveedores",
  description: "Busca en las compras públicas dominicanas por producto, institución, proveedor, RNC o código de proceso.",
  alternates: { canonical: "/buscar" },
};

export default function BuscarPage(props: PageProps<"/buscar">) {
  return (
    <div className="container-page py-8 md:py-10">
      <h1 className="text-[2rem] font-extrabold md:text-[2.5rem]">Buscar</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Busca en procesos de compra, contratos, instituciones, proveedores y obras. No importa si escribes con o sin
        tildes, ni pequeños errores de escritura.
      </p>
      <Suspense
        fallback={
          <div className="mt-6">
            <SearchBox size="md" />
            <div className="mt-6">
              <Skeleton lines={4} label="Buscando…" />
            </div>
          </div>
        }
      >
        <SearchContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({ searchParams }: { searchParams: PageProps<"/buscar">["searchParams"] }) {
  const p = parseSearch(await searchParams);
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let result, facets, institutions, supplier: string | null = null;
  try {
    [result, facets, institutions] = await Promise.all([search(p), searchFacets(), institutionOptions()]);
    if (p.proveedor) supplier = await supplierName(p.proveedor);
  } catch {
    return (
      <div className="mt-6">
        <SearchBox size="md" defaultValue={p.q} />
        <div className="mt-6">
          <ErrorState />
        </div>
      </div>
    );
  }
  const base = { ...p, pagina: undefined };
  const advancedActive = Boolean(
    p.estado || p.familia || p.provincia || p.moneda || p.anio || p.modalidad || p.alertas || p.documentos !== undefined,
  );
  const chips = activeChips(p, institutions, supplier);

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-4 lg:col-start-2">
        <SearchBox size="md" defaultValue={p.q} hidden={{ tipo: p.tipo }} />
        {aiEnabled() && <AskBox />}
      </div>

      <aside className="lg:col-start-1 lg:row-span-2 lg:row-start-1" aria-labelledby="filtros-titulo">
        <details className="card p-4" open={chips.length > 0 || undefined}>
          <summary className="flex min-h-12 items-center gap-2 text-lg font-bold text-navy-deep">
            <SlidersHorizontal aria-hidden="true" className="size-5" />
            <span id="filtros-titulo">Filtros</span>
            {chips.length > 0 && <span className="text-sm font-bold text-ink-muted">({chips.length} activos)</span>}
          </summary>
          <form action="/buscar" method="get" className="mt-3 space-y-4">
            {p.q && <input type="hidden" name="q" value={p.q} />}
            {p.proveedor && <input type="hidden" name="proveedor" value={p.proveedor} />}
            <fieldset className="space-y-4">
              <legend className="eyebrow">Filtros básicos</legend>
              <div>
                <label className="label" htmlFor="f-tipo">Mostrar</label>
                <select id="f-tipo" name="tipo" defaultValue={p.tipo ?? ""} className="field">
                  <option value="">Todo</option>
                  {Object.entries(ENTITY_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}s</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="f-inst">Institución</label>
                <select id="f-inst" name="institucion" defaultValue={p.institucion ?? ""} className="field">
                  <option value="">Todas</option>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>{i.acronym ? `${i.name} (${i.acronym})` : i.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="f-desde">Desde</label>
                  <input id="f-desde" name="desde" type="date" defaultValue={p.desde} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="f-hasta">Hasta</label>
                  <input id="f-hasta" name="hasta" type="date" defaultValue={p.hasta} className="field" />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="f-objeto">Tipo de compra</label>
                <select id="f-objeto" name="objeto" defaultValue={p.objeto ?? ""} className="field">
                  <option value="">Todos</option>
                  <option value="Bienes">Bienes</option>
                  <option value="Servicios">Servicios</option>
                  <option value="Obras">Obras</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="f-min">Monto mínimo (RD$)</label>
                  <input id="f-min" name="min" type="number" min={0} step="any" inputMode="numeric" defaultValue={p.min} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="f-max">Monto máximo (RD$)</label>
                  <input id="f-max" name="max" type="number" min={0} step="any" inputMode="numeric" defaultValue={p.max} className="field" />
                </div>
              </div>
            </fieldset>

            <details open={advancedActive || undefined} className="border-2 border-ink p-3">
              <summary className="flex min-h-12 items-center font-bold text-navy">Filtros avanzados</summary>
              <fieldset className="mt-2 space-y-4">
                <legend className="sr-only">Filtros avanzados</legend>
                <div>
                  <label className="label" htmlFor="f-estado">Estado del procedimiento</label>
                  <select id="f-estado" name="estado" defaultValue={p.estado ?? ""} className="field">
                    <option value="">Cualquiera</option>
                    {facets.statuses.map((s) => (
                      <option key={s.value} value={s.value}>{s.value}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="f-mod">Modalidad de contratación</label>
                  <select id="f-mod" name="modalidad" defaultValue={p.modalidad ?? ""} className="field">
                    <option value="">Cualquiera</option>
                    {facets.modalities.map((s) => (
                      <option key={s.value} value={s.value}>{s.value}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="f-fam">Categoría (UNSPSC)</label>
                  <select id="f-fam" name="familia" defaultValue={p.familia ?? ""} className="field">
                    <option value="">Todas</option>
                    {facets.families.map((f) => (
                      <option key={f.value} value={f.value}>{f.name.trim()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="f-prov">Provincia del proveedor u obra</label>
                  <input id="f-prov" name="provincia" defaultValue={p.provincia} className="field" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label" htmlFor="f-anio">Año</label>
                    <select id="f-anio" name="anio" defaultValue={p.anio ?? ""} className="field">
                      <option value="">Todos</option>
                      {facets.years.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="f-mon">Moneda</label>
                    <select id="f-mon" name="moneda" defaultValue={p.moneda ?? ""} className="field">
                      <option value="">Todas</option>
                      <option value="DOP">Pesos (DOP)</option>
                      <option value="USD">Dólares (USD)</option>
                      <option value="EUR">Euros (EUR)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="f-docs">Documentación</label>
                  <select id="f-docs" name="documentos" defaultValue={p.documentos === undefined ? "" : p.documentos ? "1" : "0"} className="field">
                    <option value="">Cualquiera</option>
                    <option value="1">Con documentos publicados</option>
                    <option value="0">Sin documentos encontrados</option>
                  </select>
                </div>
                <label className="flex min-h-12 items-center gap-3 font-bold">
                  <input type="checkbox" name="alertas" value="1" defaultChecked={p.alertas} className="size-5 accent-[#12345A]" />
                  Solo con alertas publicadas
                </label>
              </fieldset>
            </details>

            <div>
              <label className="label" htmlFor="f-orden">Ordenar por</label>
              <select id="f-orden" name="orden" defaultValue={p.orden ?? (p.q ? "relevancia" : "fecha")} className="field">
                <option value="relevancia">Relevancia</option>
                <option value="fecha">Fecha (más reciente)</option>
                <option value="monto">Monto (mayor a menor)</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-primary">Aplicar filtros</button>
              <Link href={p.q ? `/buscar?q=${encodeURIComponent(p.q)}` : "/buscar"} className="btn btn-quiet">
                Quitar filtros
              </Link>
            </div>
          </form>
        </details>
      </aside>

      <section className="min-w-0 lg:col-start-2" aria-labelledby="resultados-titulo">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="resultados-titulo" className="text-xl font-bold" aria-live="polite">
            {result.total === 0
              ? "direct" in result && result.direct?.length
                ? "Resultados por código"
                : "Sin resultados"
              : `${formatNumber(result.total)} ${result.total === 1 ? "resultado" : "resultados"}${p.q ? ` para «${p.q}»` : ""}`}
          </h2>
          {result.total > 0 && (
            <a href={`/api/search${toQuery(base, { format: "csv", limite: 100 })}`} className="btn btn-quiet" download>
              <Download aria-hidden="true" className="size-5" /> Descargar (CSV)
            </a>
          )}
        </div>
        {chips.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-2" aria-label="Filtros activos">
            {chips.map((c) => (
              <li key={c.key}>
                <Link
                  href={`/buscar${toQuery(base, { [c.key]: undefined })}`}
                  className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-navy/30 bg-sky px-3 font-bold text-navy no-underline"
                >
                  {c.label}
                  <X aria-hidden="true" className="size-4" />
                  <span className="sr-only">(quitar filtro)</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {"direct" in result && result.direct && result.direct.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 font-bold">Coincidencia por código oficial</h3>
            <ul className="space-y-3">
              {result.direct.map((h) => (
                <li key={`d-${h.entity_type}-${h.entity_id}`}>
                  <ResultCard hit={h} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.fuzzy && result.total > 0 && (
          <div className="mb-4">
            <Notice>
              No encontramos coincidencias exactas para «{p.q}». Mostramos resultados para{" "}
              <strong>«{"corrected" in result ? result.corrected : ""}»</strong>.
            </Notice>
          </div>
        )}
        {result.total === 0 && "direct" in result && result.direct?.length ? null : result.total === 0 ? (
          <EmptyState
            title={p.q ? `No encontramos resultados para «${p.q}»` : "No hay resultados con estos filtros"}
            action={
              <Link className="btn btn-secondary" href="/buscar">
                Empezar una búsqueda nueva
              </Link>
            }
          >
            <ul className="list-disc pl-5">
              <li>Prueba con una palabra más general, por ejemplo «computadora» en vez de un modelo.</li>
              <li>Quita algunos filtros o amplía el rango de fechas.</li>
              <li>Si buscas una empresa, prueba con su RNC sin guiones.</li>
            </ul>
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {result.hits.map((h) => (
              <li key={`${h.entity_type}-${h.entity_id}`}>
                <ResultCard hit={h} />
              </li>
            ))}
          </ul>
        )}
        <Pagination page={result.page} pages={result.pages} hrefFor={(n) => `/buscar${toQuery(base, { pagina: n })}`} />
        <div className="mt-8">
          <Suspense fallback={null}>
            <DataFreshness />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

function activeChips(p: SearchParams, institutions: { id: number; name: string }[], supplier: string | null) {
  const chips: { key: string; label: string }[] = [];
  if (p.tipo) chips.push({ key: "tipo", label: `Mostrar: ${ENTITY_TYPE_LABEL[p.tipo]}` });
  if (p.institucion) chips.push({ key: "institucion", label: `Institución: ${institutions.find((i) => i.id === p.institucion)?.name ?? p.institucion}` });
  if (p.proveedor) chips.push({ key: "proveedor", label: `Proveedor: ${supplier ?? p.proveedor}` });
  if (p.desde) chips.push({ key: "desde", label: `Desde ${p.desde}` });
  if (p.hasta) chips.push({ key: "hasta", label: `Hasta ${p.hasta}` });
  if (p.objeto) chips.push({ key: "objeto", label: `Tipo: ${p.objeto}` });
  if (p.min !== undefined) chips.push({ key: "min", label: `Desde ${formatMoney(p.min)}` });
  if (p.max !== undefined) chips.push({ key: "max", label: `Hasta ${formatMoney(p.max)}` });
  if (p.estado) chips.push({ key: "estado", label: `Estado: ${p.estado}` });
  if (p.modalidad) chips.push({ key: "modalidad", label: `Modalidad: ${p.modalidad}` });
  if (p.familia) chips.push({ key: "familia", label: `Categoría ${p.familia}` });
  if (p.provincia) chips.push({ key: "provincia", label: `Provincia: ${p.provincia}` });
  if (p.anio) chips.push({ key: "anio", label: `Año ${p.anio}` });
  if (p.moneda) chips.push({ key: "moneda", label: `Moneda ${p.moneda}` });
  if (p.alertas) chips.push({ key: "alertas", label: "Con alertas" });
  if (p.documentos !== undefined) chips.push({ key: "documentos", label: p.documentos ? "Con documentos" : "Sin documentos" });
  return chips;
}
