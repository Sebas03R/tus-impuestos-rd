import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { EmptyState, ErrorState, Fig, PageHeader, Pagination, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { listInstitutions } from "@/lib/queries/entities";
import { flattenParams, toQuery } from "@/lib/queries/filters";

export const metadata: Metadata = {
  title: "Instituciones públicas",
  description: "Directorio de instituciones del Estado dominicano con sus compras y contratos registrados en la DGCP.",
  alternates: { canonical: "/instituciones" },
};

export default function InstitutionsPage(props: PageProps<"/instituciones">) {
  return (
    <>
      <PageHeader
        eyebrow="Directorio"
        title="Instituciones públicas"
        intro={<p>Ministerios, hospitales, ayuntamientos y demás unidades de compra registradas en la DGCP. No calificamos instituciones como buenas o malas: mostramos sus registros.</p>}
      />
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={5} label="Cargando instituciones…" />}>
          <List searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/instituciones">["searchParams"] }) {
  const raw = flattenParams(await searchParams);
  const q = raw.q?.slice(0, 120);
  const page = Math.max(1, Math.min(500, Number.parseInt(raw.pagina ?? "1", 10) || 1));
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let data;
  try {
    data = await listInstitutions({ q, page });
  } catch {
    return <ErrorState />;
  }
  return (
    <div>
      <form action="/instituciones" method="get" role="search" className="mb-6 flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="iq" className="label">Buscar una institución</label>
          <input id="iq" name="q" defaultValue={q} className="field" placeholder="Ej.: Educación, MINERD, hospital" />
        </div>
        <button className="btn btn-primary" type="submit">Buscar</button>
      </form>
      <p className="mb-4 text-ink-muted">{formatNumber(data.total)} instituciones con procesos de compra registrados.</p>
      {data.rows.length === 0 ? (
        <EmptyState title="No encontramos instituciones con ese nombre" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.rows.map((i) => (
            <li key={i.id}>
              <Link href={`/instituciones/${i.slug}`} className="card flex h-full items-center justify-between gap-4 p-4 no-underline hover:shadow-[var(--shadow-raise)]">
                <span className="min-w-0">
                  <span className="block font-bold text-navy-deep">{i.name}</span>
                  <span className="block text-sm text-ink-muted">
                    {[i.acronym, i.kind].filter(Boolean).join(" · ")} · <Fig>{formatNumber(i.processes)}</Fig> procesos · <Fig>{formatNumber(i.contracts)}</Fig> contratos
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-navy" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pages={data.pages} hrefFor={(n) => `/instituciones${toQuery({ q, pagina: n })}`} />
    </div>
  );
}
