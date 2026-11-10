import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { EmptyState, ErrorState, Fig, PageHeader, Pagination, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { listSuppliers } from "@/lib/queries/entities";
import { flattenParams, toQuery } from "@/lib/queries/filters";

export const metadata: Metadata = {
  title: "Proveedores del Estado",
  description: "Empresas y personas que venden al Estado dominicano, con sus contratos registrados en la DGCP.",
  alternates: { canonical: "/proveedores" },
};

export default function SuppliersPage(props: PageProps<"/proveedores">) {
  return (
    <>
      <PageHeader
        eyebrow="Directorio"
        title="¿Quién vende productos al Estado?"
        intro={<p>Proveedores con contratos registrados en el período sincronizado. Busca por nombre o RNC.</p>}
      />
      <div className="container-page py-10">
        <Suspense fallback={<Skeleton lines={5} label="Cargando proveedores…" />}>
          <List searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/proveedores">["searchParams"] }) {
  const raw = flattenParams(await searchParams);
  const q = raw.q?.slice(0, 120);
  const page = Math.max(1, Math.min(1000, Number.parseInt(raw.pagina ?? "1", 10) || 1));
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let data;
  try {
    data = await listSuppliers({ q, page });
  } catch {
    return <ErrorState />;
  }
  return (
    <div>
      <form action="/proveedores" method="get" role="search" className="mb-6 flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="pq" className="label">Nombre o RNC del proveedor</label>
          <input id="pq" name="q" defaultValue={q} className="field" inputMode="search" />
        </div>
        <button className="btn btn-primary" type="submit">Buscar</button>
      </form>
      <p className="mb-4 text-ink-muted">
        {formatNumber(data.total)} proveedores, ordenados por cantidad de contratos. Tener muchos contratos no indica por sí solo ningún problema.
      </p>
      {data.rows.length === 0 ? (
        <EmptyState title="No encontramos proveedores con ese nombre o RNC" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.rows.map((s) => (
            <li key={s.id}>
              <Link href={`/proveedores/${s.id}`} className="card flex h-full items-center justify-between gap-4 p-4 no-underline hover:shadow-[var(--shadow-raise)]">
                <span className="min-w-0">
                  <span className="block font-bold text-navy-deep">{s.name}</span>
                  <span className="block text-sm text-ink-muted">
                    <Fig>{formatNumber(s.contracts)}</Fig> contratos · <Fig>{formatNumber(s.institutions)}</Fig> instituciones{s.province ? ` · ${s.province}` : ""}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-navy" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pages={data.pages} hrefFor={(n) => `/proveedores${toQuery({ q, pagina: n })}`} />
    </div>
  );
}
