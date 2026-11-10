import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { BarList, ColumnChart } from "@/components/charts";
import { DataFreshness } from "@/components/data-status";
import { ResultCard } from "@/components/result-card";
import { EmptyState, ErrorState, PageHeader, Pagination, SectionHeading, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/format";
import { MODALITY_HELP } from "@/lib/labels";
import { parseSearch, toQuery } from "@/lib/queries/filters";
import { getProcurementOverview, OPEN_STATUSES } from "@/lib/queries/processes";
import { search } from "@/lib/queries/search";

export const metadata: Metadata = {
  title: "Compras públicas",
  description: "Procesos de compra, adjudicaciones y contratos registrados por la DGCP, explicados de forma sencilla.",
  alternates: { canonical: "/compras" },
};

const VIEWS = [
  { key: "recientes", label: "Compras recientes" },
  { key: "abiertos", label: "Procesos abiertos" },
  { key: "adjudicados", label: "Procesos adjudicados" },
  { key: "contratos", label: "Contratos registrados" },
] as const;

export default function ComprasPage(props: PageProps<"/compras">) {
  return (
    <>
      <PageHeader
        eyebrow="Fuente: DGCP"
        title="Compras públicas"
        intro={
          <p>
            Lo que el Estado compra, a quién y por cuánto. Distinguimos siempre el <strong>monto estimado</strong> (al
            publicar), el <strong>adjudicado</strong> y el <strong>contratado</strong>: son etapas distintas y no se suman.
          </p>
        }
      />
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={5} label="Cargando resumen de compras…" />}>
          <Overview />
        </Suspense>
        <section aria-labelledby="listado" className="mt-14">
          <SectionHeading id="listado" title="Explora los registros" />
          <Suspense fallback={<Skeleton lines={4} label="Cargando listado…" />}>
            <Listing searchParams={props.searchParams} />
          </Suspense>
        </section>
        <div className="mt-10">
          <Suspense fallback={null}>
            <DataFreshness />
          </Suspense>
        </div>
      </div>
    </>
  );
}

async function Overview() {
  await connection();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let o;
  try {
    o = await getProcurementOverview();
  } catch {
    return <ErrorState />;
  }
  const year = new Date().getFullYear();
  return (
    <div className="grid gap-10">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <dt className="font-bold text-ink-muted">Procesos publicados en {year}</dt>
          <dd className="mt-2"><span className="fig text-[2.75rem]">{formatNumber(o.statusCounts?.total_year)}</span></dd>
        </div>
        <div className="card p-5">
          <dt className="font-bold text-ink-muted">Abiertos ahora</dt>
          <dd className="mt-2"><span className="fig text-[2.75rem]">{formatNumber(o.statusCounts?.open)}</span></dd>
        </div>
        <div className="card p-5">
          <dt className="font-bold text-ink-muted">Adjudicados en {year}</dt>
          <dd className="mt-2"><span className="fig text-[2.75rem]">{formatNumber(o.statusCounts?.awarded)}</span></dd>
        </div>
      </dl>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="card p-5">
          {o.byMonth.length ? (
            <ColumnChart
              title="Contratos registrados por mes"
              caption="Cantidad de contratos según la fecha de adjudicación (últimos 12 meses)."
              valueLabel="Contratos"
              data={o.byMonth.map((m) => ({
                label: monthLabel(m.month),
                value: m.contracts,
                display: `${formatNumber(m.contracts)} contratos · ${formatMoney(m.contracted_dop, "DOP", { compact: true })} contratados (DOP)`,
              }))}
            />
          ) : (
            <EmptyState title="Aún no hay contratos sincronizados" />
          )}
        </div>
        <div className="card p-5">
          <BarList
            title={`Procesos por modalidad en ${year}`}
            caption="Cantidad de procesos publicados este año según cómo se compra."
            valueLabel="Procesos"
            data={o.byModality.map((m) => ({
              label: m.modality,
              value: m.processes,
              display: formatNumber(m.processes),
              note: MODALITY_HELP[m.modality],
              href: `/buscar?tipo=proceso&modalidad=${encodeURIComponent(m.modality)}&anio=${year}`,
            }))}
          />
        </div>
        <div className="card p-5">
          <BarList
            title={`Instituciones con más contratos en ${year}`}
            caption="Por cantidad de contratos. Montos en pesos dominicanos; los contratos en otras monedas no se suman."
            valueLabel="Contratos"
            data={o.topInstitutions.map((i) => ({
              label: i.name,
              value: i.contracts,
              display: `${formatNumber(i.contracts)} · ${formatMoney(i.contracted_dop, "DOP", { compact: true })} contratados`,
              href: `/instituciones/${i.slug}`,
            }))}
          />
        </div>
        <div className="card p-5">
          <BarList
            title={`Proveedores con más contratos en ${year}`}
            caption="Por cantidad de contratos. Tener muchos contratos no indica por sí solo ningún problema."
            valueLabel="Contratos"
            data={o.topSuppliers.map((s) => ({
              label: s.name,
              value: s.contracts,
              display: `${formatNumber(s.contracts)} · ${formatMoney(s.contracted_dop, "DOP", { compact: true })} contratados`,
              href: `/proveedores/${s.id}`,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

async function Listing({ searchParams }: { searchParams: PageProps<"/compras">["searchParams"] }) {
  const raw = await searchParams;
  const p = parseSearch(raw);
  const view = VIEWS.find((v) => v.key === raw.vista)?.key ?? "recientes";
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let result;
  try {
    result = await search({
      tipo: view === "contratos" ? "contrato" : "proceso",
      estados: view === "abiertos" ? OPEN_STATUSES : view === "adjudicados" ? ["Proceso adjudicado y celebrado"] : undefined,
      orden: "fecha",
      pagina: p.pagina,
      limite: 15,
    });
  } catch {
    return <ErrorState />;
  }
  return (
    <div>
      <nav aria-label="Vistas del listado" className="mb-5">
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <li key={v.key}>
              <Link
                href={`/compras${toQuery({ vista: v.key === "recientes" ? undefined : v.key })}#listado`}
                aria-current={v.key === view ? "page" : undefined}
                className="inline-flex min-h-12 items-center rounded-full border-2 border-ink px-4 font-bold text-navy no-underline hover:bg-sky aria-[current=page]:bg-navy aria-[current=page]:text-white"
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {result.total === 0 ? (
        <EmptyState title="No hay registros en esta vista todavía" />
      ) : (
        <>
          <p className="mb-4 text-ink-muted">{formatNumber(result.total)} registros, del más reciente al más antiguo.</p>
          <ul className="space-y-4">
            {result.hits.map((h) => (
              <li key={`${h.entity_type}-${h.entity_id}`}>
                <ResultCard hit={h} />
              </li>
            ))}
          </ul>
          <Pagination
            page={result.page}
            pages={Math.min(result.pages, 200)}
            hrefFor={(n) => `/compras${toQuery({ vista: view === "recientes" ? undefined : view, pagina: n })}#listado`}
          />
        </>
      )}
    </div>
  );
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 15));
  return new Intl.DateTimeFormat("es-DO", { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
}

