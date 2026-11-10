import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { DataFreshness } from "@/components/data-status";
import { formatTimes, GaugeLegend, PriceGauge, PriceTags, timesFromPct, timesPhrase, TimesBar, unitSingular } from "@/components/meters";
import { SearchBox } from "@/components/search-box";
import { EmptyState, ErrorState, ExternalA, Fig, Pill, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDate, formatMoney, formatNumber, sentenceCase, truncate } from "@/lib/format";
import { ALERT_DISCLAIMER } from "@/lib/labels";
import { alertTypeCounts } from "@/lib/queries/alerts";
import {
  biggestRecentProcesses,
  CASE_SLUGS,
  CASES,
  failedAttempts,
  featuredInflated,
  getCase,
  getCaseRecent,
  getInflationOverview,
  pickCaseOfMonth,
  topInflated,
  type BigProcess,
  type CaseData,
  type CasePick,
  type FailedAttempt,
  type InflatedRow,
} from "@/lib/queries/protest";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const EXAMPLES = [
  { label: "Habichuelas con dulce", q: "habichuelas con dulce" },
  { label: "Computadoras", q: "computadoras" },
  { label: "Medicamentos", q: "medicamentos" },
  { label: "Vehículos", q: "vehículos" },
  { label: "Ministerio de Educación", q: "Ministerio de Educación" },
];

/** Cada tipo de alerta del Radar, dicho como lo diría la gente. */
const SIGNALS: Record<string, { title: string; text: string }> = {
  fraccionamiento: {
    title: "Compras partidas en pedazos",
    text: "Varias compras chiquitas de lo mismo, una detrás de otra, que juntas pasan del monto que obliga a licitar.",
  },
  competencia_limitada: {
    title: "Un solo oferente",
    text: "Procesos que debían ser competitivos y donde se presentó una sola oferta.",
  },
  adjudicaciones_recurrentes: {
    title: "Siempre el mismo proveedor",
    text: "Una empresa se lleva gran parte de lo que una institución compra en un rubro.",
  },
  diferencia_etapas: {
    title: "Contrataron más de lo previsto",
    text: "El contrato firmado supera por mucho el monto que la institución estimó al abrir el proceso.",
  },
  incremento_contractual: {
    title: "Contratos que crecieron",
    text: "El monto subió después de firmado el contrato.",
  },
  patron_temporal: {
    title: "Compras de última hora",
    text: "Muchas compras juntas en fechas inusuales, como el cierre del año fiscal.",
  },
  documentacion_insuficiente: {
    title: "Faltan documentos",
    text: "No aparecen documentos que esa modalidad de compra exige publicar.",
  },
};

export default function HomePage(props: PageProps<"/">) {
  return (
    <>
      <Suspense fallback={<HeroFallback />}>
        <Hero />
      </Suspense>

      <Suspense fallback={<div className="h-40 border-b-[3px] border-ink bg-red" />}>
        <TotalBand />
      </Suspense>

      <section aria-labelledby="ranking-titulo" id="ranking" className="container-page scroll-mt-28 py-12 md:py-16">
        <Suspense fallback={<Skeleton lines={8} label="Cargando el ranking…" />}>
          <Ranking searchParams={props.searchParams} />
        </Suspense>
      </section>

      <section aria-labelledby="mas-grandes-titulo" id="mas-grandes" className="scroll-mt-28 border-t-[3px] border-ink bg-mist">
        <div className="container-page py-12 md:py-16">
          <p className="kicker kicker-ink">Lo que se está comprando ahora</p>
          <h2 id="mas-grandes-titulo" className="display-2 mt-3">Las compras más grandes del último mes</h2>
          <p className="mt-3 max-w-2xl text-lg">
            Procesos publicados en los últimos 30 días, de mayor a menor monto estimado. Se actualiza solo, cuatro veces al
            día, con los datos de la DGCP: si mañana sale una licitación más grande, aparece aquí.
          </p>
          <Suspense fallback={<div className="mt-8"><Skeleton lines={6} label="Cargando las compras más grandes…" /></div>}>
            <BiggestRecent />
          </Suspense>
        </div>
      </section>

      <Suspense fallback={null}>
        <FailedAttempts searchParams={props.searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <CaseOfTheMonth searchParams={props.searchParams} />
      </Suspense>

      <section aria-labelledby="senales" className="container-page py-12 md:py-16">
        <p className="kicker kicker-ink">No es solo el precio</p>
        <h2 id="senales" className="display-2 mt-3">Otras señales que piden explicación</h2>
        <p className="mt-3 max-w-2xl text-lg">
          El Radar revisa cada compra con reglas públicas. Estas son las señales que encontró, además de los precios.
        </p>
        <Suspense fallback={<Skeleton lines={4} label="Cargando señales…" />}>
          <Signals />
        </Suspense>
      </section>

      <section aria-labelledby="buscar-titulo" className="border-y-[3px] border-ink bg-mist">
        <div className="container-page py-12 md:py-14">
          <h2 id="buscar-titulo" className="display-2">Busca qué compró tu ayuntamiento</h2>
          <p className="mt-3 max-w-2xl text-lg">
            Productos, instituciones, empresas, RNC o códigos de proceso. Todo enlaza al registro oficial.
          </p>
          <div className="mt-6 max-w-3xl">
            <SearchBox size="lg" />
          </div>
          <div className="mt-5">
            <p className="text-sm font-bold">Prueba con:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <li key={e.q}>
                  <Link
                    href={`/buscar?q=${encodeURIComponent(e.q)}`}
                    className="inline-flex min-h-11 items-center border-2 border-ink bg-white px-3 font-bold text-ink no-underline hover:bg-yellow"
                  >
                    {e.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="como" className="container-page py-12 md:py-16">
        <h2 id="como" className="display-2">¿Cómo sabemos que está caro?</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            {
              t: "Buscamos lo mismo",
              d: "Compras del mismo artículo en otras instituciones: misma categoría oficial, misma unidad y una descripción casi igual, en los últimos doce meses.",
            },
            {
              t: "Sacamos el precio típico",
              d: "Usamos la mediana, el precio del medio. Una compra rara, muy barata o muy cara, no la mueve.",
            },
            {
              t: "Medimos la diferencia",
              d: "Si pagaron más de 30 % por encima, aparece aquí. Si son más de 60 %, la marcamos como prioritaria.",
            },
          ].map((s, i) => (
            <li key={s.t} className="border-t-[6px] border-ink pt-4">
              <span className="font-display text-6xl font-black leading-none text-red" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="mt-2 text-xl font-bold">{s.t}</h3>
              <p className="mt-1.5">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid gap-4 border-[3px] border-ink bg-yellow-soft p-5 md:grid-cols-[1fr_auto] md:items-center">
          <p className="font-bold">{ALERT_DISCLAIMER}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/metodologia" className="btn btn-secondary">
              Ver la metodología
            </Link>
            <Link href="/correcciones" className="btn btn-quiet">
              Reportar un error
            </Link>
          </div>
        </div>
        <div className="mt-6 text-sm">
          <Suspense fallback={null}>
            <DataFreshness />
          </Suspense>
        </div>
      </section>
    </>
  );
}

/* ───────────────────────── Portada: la compra más llamativa ───────────────────────── */

function payerName(row: InflatedRow): string {
  const acr = row.institution_acronym?.trim();
  if (acr && acr.length <= 14 && !/\s{2,}/.test(acr)) return acr;
  return row.institution_name ? truncate(row.institution_name, 48) : "esta institución";
}

function HeroIntro() {
  return (
    <div>
      <p className="kicker">Es tu dinero</p>
      <h1 id="titulo" className="hero-title mt-4">
        ¿Por qué pagaron tanto?
      </h1>
      <p className="mt-5 max-w-xl text-lg md:text-xl lg:mt-8">
        Comparamos cada compra del Estado con lo que pagaron otras instituciones por lo mismo.
        Estas salieron <strong>mucho más caras</strong>.
      </p>
      <div className="mt-6 hidden flex-wrap gap-3 sm:flex">
        <Link href="#ranking" className="btn btn-primary">
          Ver las más infladas <ArrowRight aria-hidden="true" className="size-5" />
        </Link>
        <Link href="/radar?tipo=precio" className="btn btn-secondary">
          Todas las alertas de precio
        </Link>
      </div>
    </div>
  );
}

function HeroFallback() {
  return (
    <section aria-labelledby="titulo" className="border-b-[3px] border-ink">
      <div className="container-page grid gap-10 py-10 md:py-14 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        <HeroIntro />
        <Skeleton lines={6} label="Cargando la compra destacada…" />
      </div>
    </section>
  );
}

async function Hero() {
  await connection(); // datos por visita (y sin consultas a la base durante el build)
  let featured: InflatedRow | null = null;
  let failed = false;
  if (dbConfigured()) {
    try {
      featured = await featuredInflated();
    } catch {
      failed = true;
    }
  }
  const times = featured ? timesFromPct(featured.diff_pct) : null;
  return (
    <section aria-labelledby="titulo" className="border-b-[3px] border-ink">
      <div className="container-page grid gap-10 py-10 md:py-14 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        <HeroIntro />
        {failed ? (
          <ErrorState />
        ) : featured && times !== null ? (
          <article aria-labelledby="destacada" className="card-raise p-5 md:p-6">
            <p className="eyebrow">Sobreprecímetro · compra destacada</p>
            <h2 id="destacada" className="mt-1 text-[2rem] uppercase leading-none md:text-[2.5rem]">
              {sentenceCase(featured.item)}
            </h2>
            <p className="mt-1.5 font-bold">
              {featured.institution_name ?? "Institución sin dato"}
              {featured.event_date ? <span className="font-normal text-ink-muted"> · {formatDate(featured.event_date)}</span> : null}
            </p>
            <div className="mt-4 flex flex-col items-center">
              <PriceGauge diffPct={featured.diff_pct} />
              <p className="-mt-1 text-center">
                <span className="font-display text-[5rem] font-black leading-none text-red-text md:text-[6rem]">
                  ×{formatTimes(times)}
                </span>
                <span className="block text-lg font-bold">Pagó {timesPhrase(times)}</span>
              </p>
            </div>
            <div className="mt-5">
              <PriceTags
                paid={featured.paid}
                reference={featured.reference}
                currency={featured.currency}
                unit={featured.unit}
                payer={payerName(featured)}
                peers={featured.n_peers}
                institutions={featured.n_institutions}
              />
            </div>
            {featured.extra_total && (
              <p className="mt-4 text-lg">
                Diferencia total estimada en esta compra: <Fig tone="red">{formatMoney(featured.extra_total, featured.currency)}</Fig>
              </p>
            )}
            <Link href={`/radar/${featured.public_id}`} className="mt-4 inline-flex min-h-12 items-center gap-1.5 font-bold text-navy underline">
              Ver las compras comparadas y el cálculo <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </article>
        ) : (
          <EmptyState title="Todavía no hay alertas de precio publicadas">
            El análisis corre después de cada sincronización con la DGCP. Mientras tanto puedes buscar cualquier compra.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── Franja roja: el total ───────────────────────── */

async function TotalBand() {
  await connection();
  if (!dbConfigured()) return null;
  let o;
  try {
    o = await getInflationOverview();
  } catch {
    return null;
  }
  if (!o.alerts) return null;
  return (
    <section aria-labelledby="total" className="on-dark border-b-[3px] border-ink bg-red text-white">
      <div className="container-page grid gap-3 py-8 md:grid-cols-[auto_1fr] md:items-end md:gap-8 md:py-10">
        <h2 id="total" className="sr-only">
          Total pagado por encima del precio típico
        </h2>
        <p className="font-display text-[3rem] font-black uppercase leading-[0.9] tabular min-[420px]:text-[3.75rem] md:text-[5.5rem]">
          {formatMoney(o.extra_total, "DOP", { compact: true })}
        </p>
        <p className="max-w-xl text-lg font-bold md:pb-2">
          pagados por encima del precio típico en <Fig>{formatNumber(o.alerts)}</Fig> compras de <Fig>{formatNumber(o.institutions)}</Fig> instituciones
          {o.since ? ` desde ${formatDate(o.since)}` : ""}. Es un estimado: cada caso enlaza a sus pruebas.
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────── Ranking ───────────────────────── */

async function Ranking({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const sp = await searchParams;
  const by = sp.orden === "dinero" ? "dinero" : "veces";
  const tab =
    "inline-flex min-h-12 items-center border-2 border-ink px-4 font-bold text-ink no-underline hover:bg-yellow-soft aria-[current=true]:bg-ink aria-[current=true]:text-yellow";
  const header = (
    <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="kicker">Ranking</p>
        <h2 id="ranking-titulo" className="display-2 mt-3">
          {by === "dinero" ? "Donde más dinero se pagó de más" : "Las compras más infladas"}
        </h2>
        <p className="mt-3 max-w-2xl text-lg">
          {by === "dinero"
            ? "Ordenadas por la diferencia total estimada: precio pagado de más por unidad, multiplicado por la cantidad comprada."
            : "Ordenadas por cuántas veces el precio típico pagaron. La barra va de ×1 (precio normal) a ×5."}
        </p>
      </div>
      <nav aria-label="Ordenar el ranking" className="flex flex-wrap gap-2 md:shrink-0">
        <Link href="/?orden=veces#ranking" scroll={false} aria-current={by === "veces"} className={tab}>
          Más veces más caras
        </Link>
        <Link href="/?orden=dinero#ranking" scroll={false} aria-current={by === "dinero"} className={tab}>
          Más dinero de más
        </Link>
      </nav>
    </div>
  );
  if (!dbConfigured()) return <>{header}<div className="mt-6"><ErrorState>La base de datos no está configurada en este entorno.</ErrorState></div></>;
  let rows: InflatedRow[];
  try {
    rows = await topInflated({ by, limit: 10 });
  } catch {
    return <>{header}<div className="mt-6"><ErrorState /></div></>;
  }
  return (
    <>
      {header}
      <div className="mt-4">
        <GaugeLegend />
      </div>
      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Todavía no hay compras en el ranking">
            Aparecerán aquí cuando el Radar publique alertas de precio. Mientras tanto,{" "}
            <Link href="#mas-grandes" className="font-bold text-ink underline">mira las compras más grandes del último mes</Link>.
          </EmptyState>
        </div>
      ) : (
        <ol className="mt-8 grid gap-4">
          {rows.map((r, i) => (
            <RankRow key={r.public_id} row={r} rank={i + 1} by={by} />
          ))}
        </ol>
      )}
      <div className="mt-8">
        <Link href="/radar?tipo=precio" className="btn btn-secondary">
          Ver todas las alertas de precio <ArrowRight aria-hidden="true" className="size-5" />
        </Link>
      </div>
    </>
  );
}

function RankRow({ row, rank, by }: { row: InflatedRow; rank: number; by: "veces" | "dinero" }) {
  const times = timesFromPct(row.diff_pct) ?? 1;
  const per = unitSingular(row.unit);
  return (
    <li className="card grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 p-4 md:grid-cols-[4rem_minmax(0,1.4fr)_minmax(0,1fr)] md:gap-x-6 md:p-5">
      <span aria-hidden="true" className="font-display text-[2.5rem] font-black leading-[0.85] text-ink md:text-6xl">
        {rank}
      </span>
      <div>
        <h3 className="text-lg font-bold leading-snug">
          <span className="sr-only">Puesto {rank}: </span>
          <Link href={`/radar/${row.public_id}`} className="text-ink underline decoration-2 underline-offset-4 hover:bg-yellow-soft">
            {sentenceCase(row.item)}
          </Link>
        </h3>
        <p className="text-[0.9375rem] text-ink-muted">
          {row.institution_name ?? "Institución sin dato"}
          {row.event_date ? ` · ${formatDate(row.event_date, "short")}` : ""}
          {row.purchases > 1 ? ` · ${formatNumber(row.purchases)} líneas de compra` : ""}
        </p>
        <p className="mt-2 text-[0.9375rem]">
          Pagó <Fig tone="red">{formatMoney(row.paid, row.currency)}</Fig> por {per}; otras instituciones,{" "}
          <Fig>{formatMoney(row.reference, row.currency)}</Fig>.
        </p>
      </div>
      <div className="col-span-2 flex flex-col gap-2 md:col-span-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`font-display font-black leading-none tabular ${by === "veces" ? "text-[2.5rem] text-red-text" : "text-2xl"}`}>
            ×{formatTimes(times)}
          </span>
          {row.extra_total && (
            <span className={`text-right tabular ${by === "dinero" ? "font-display text-[1.75rem] font-black leading-none text-red-text" : "text-sm font-bold"}`}>
              +{formatMoney(row.extra_total, row.currency, { compact: true })}
              <span className="block font-sans text-xs font-bold text-ink-muted">diferencia estimada</span>
            </span>
          )}
        </div>
        <TimesBar diffPct={row.diff_pct} />
        <p className="text-sm text-ink-muted">
          {row.public_label === "revision_prioritaria" ? "Revisión prioritaria" : "Revisión sugerida"} · {timesPhrase(times)}
        </p>
      </div>
    </li>
  );
}

/* ───────────────────────── Intentos de compra ───────────────────────── */

function stampFor(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("cancel")) return "Cancelado";
  if (s.includes("desiert")) return "Desierto";
  if (s.includes("suspend")) return "Suspendido";
  if (s.includes("anul")) return "Anulado";
  return "Bajó de monto";
}

async function FailedAttempts({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  if (!dbConfigured()) return null;
  const sp = await searchParams;
  const by = sp.intentos === "recientes" ? "recientes" : "monto";
  let rows: FailedAttempt[];
  try {
    rows = await failedAttempts({ by, days: 90, limit: 6 });
  } catch (e) {
    console.error("[intentos de compra]", e);
    return null;
  }
  if (rows.length === 0) return null;
  const tab =
    "inline-flex min-h-12 items-center border-2 border-yellow px-4 font-bold text-yellow no-underline hover:bg-white/10 aria-[current=true]:bg-yellow aria-[current=true]:text-ink";
  return (
    <section aria-labelledby="intentos-titulo" id="intentos" className="on-dark scroll-mt-28 border-b-[3px] border-ink bg-ink text-white">
      <div className="container-page py-12 md:py-16">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="kicker">Intentos de compra</p>
            <h2 id="intentos-titulo" className="display-2 mt-3 text-white">
              Lo que intentaron comprar
            </h2>
            <p className="mt-3 max-w-2xl text-lg text-[#d9d9d9]">
              Los procesos más grandes de los últimos 90 días que se cancelaron, quedaron desiertos o bajaron de monto.
              Cuando vemos un cambio de monto o de estado, guardamos el antes y el después con su fecha.
            </p>
          </div>
          <nav aria-label="Ordenar los intentos de compra" className="flex flex-wrap gap-2 md:shrink-0">
            <Link href="/?intentos=monto#intentos" scroll={false} aria-current={by === "monto"} className={tab}>
              Los más altos
            </Link>
            <Link href="/?intentos=recientes#intentos" scroll={false} aria-current={by === "recientes"} className={tab}>
              Los más recientes
            </Link>
          </nav>
        </div>
        <ol className="mt-8 grid gap-4 md:grid-cols-2">
          {rows.map((r) => {
            const lowered = r.estimated_amount !== null && Number(r.peak_amount) > Number(r.estimated_amount);
            const stamp = stampFor(r.status);
            const changes = (r.events ?? []).filter((e) => e.amount || e.status);
            return (
              <li key={r.code} className="relative flex flex-col gap-3 border-[3px] border-white bg-white p-4 text-ink md:p-5">
                <span
                  aria-hidden="true"
                  className="absolute right-4 top-4 rotate-[-8deg] border-[3px] border-red px-2 py-0.5 font-display text-xl font-black uppercase tracking-wide text-red-text"
                >
                  {stamp}
                </span>
                <p className="pr-28">
                  <span className="block text-sm font-bold uppercase tracking-wide text-ink-muted">
                    {lowered ? "Primero pidieron" : "Intentaron comprar"}
                  </span>
                  <Fig className="whitespace-normal text-[2.125rem] leading-[1.05] min-[420px]:text-[2.5rem]">
                    {formatMoney(r.peak_amount, r.currency, { compact: true })}
                  </Fig>
                  {lowered && (
                    <span className="mt-1 block text-[0.9375rem]">
                      Luego bajó a <Fig tone="red">{formatMoney(r.estimated_amount, r.currency, { compact: true })}</Fig>
                    </span>
                  )}
                  <span className="sr-only">. Estado: {r.status ?? stamp}.</span>
                </p>
                <div>
                  <p className="font-bold leading-snug">
                    {r.institution_slug ? (
                      <Link href={`/instituciones/${r.institution_slug}`} className="text-ink underline decoration-2 underline-offset-4">
                        {r.institution_name}
                      </Link>
                    ) : (
                      (r.institution_name ?? "Institución sin dato")
                    )}
                  </p>
                  <h3 className="mt-1 text-[1.0625rem] font-normal leading-snug">
                    <Link href={`/compras/${encodeURIComponent(r.code)}`} className="text-ink underline decoration-1 underline-offset-4 hover:bg-yellow-soft">
                      {truncate(sentenceCase(r.title) || r.code, 150)}
                    </Link>
                  </h3>
                </div>
                {changes.length > 0 && (
                  <ul className="grid gap-1 border-l-[3px] border-red pl-3 text-sm">
                    {changes.slice(-4).map((e) => (
                      <li key={`${e.at}-${e.amount?.join() ?? ""}-${e.status?.join() ?? ""}`}>
                        <span className="font-bold">{formatDate(e.at, "short")}:</span>{" "}
                        {e.amount
                          ? `monto de ${formatMoney(e.amount[0], r.currency, { compact: true })} a ${formatMoney(e.amount[1], r.currency, { compact: true })}`
                          : `estado de «${sentenceCase(e.status?.[0]) || "sin dato"}» a «${sentenceCase(e.status?.[1]) || "sin dato"}»`}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                  {r.published_at && <span>Publicado el {formatDate(r.published_at)}</span>}
                  {(r.docs ?? []).slice(0, 2).map((d) => (
                    <ExternalA key={d.url + d.name} href={d.url}>
                      {truncate(d.name.replace(/\.(pdf|docx?|xlsx?)$/i, ""), 40)}
                    </ExternalA>
                  ))}
                  {r.official_url && <ExternalA href={r.official_url}>Ver en la DGCP</ExternalA>}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 max-w-3xl text-sm text-[#d9d9d9]">
          Cancelar o declarar desierta una licitación es un procedimiento previsto en la ley y no implica por sí solo una
          irregularidad. Los montos anteriores solo aparecen cuando vimos el cambio; lo que pasó antes de que el
          proceso llegara a nuestros datos está en sus documentos oficiales.
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────── Las compras más grandes del mes ───────────────────────── */

const isException = (modality: string | null) => /excepci/i.test(modality ?? "");

async function BiggestRecent() {
  await connection();
  if (!dbConfigured()) return null;
  let rows: BigProcess[];
  try {
    rows = await biggestRecentProcesses({ days: 30, limit: 8 });
  } catch {
    return <div className="mt-8"><ErrorState /></div>;
  }
  if (rows.length === 0) {
    return (
      <div className="mt-8">
        <EmptyState title="No hay procesos publicados en los últimos 30 días">
          Revisa el estado de la sincronización en la página de fuentes.
        </EmptyState>
      </div>
    );
  }
  return (
    <ol className="mt-8 grid gap-4 md:grid-cols-2">
      {rows.map((p, i) => (
        <li key={p.code} className="card flex flex-col gap-3 bg-white p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0">
              <span className="sr-only">Puesto {i + 1}: </span>
              <Fig className="whitespace-normal text-[2.125rem] leading-[1.05] min-[420px]:text-[2.5rem] md:text-[3rem]">{formatMoney(p.estimated_amount, p.currency, { compact: true })}</Fig>
              <span className="mt-1 block text-sm text-ink-muted">
                {formatMoney(p.estimated_amount, p.currency, { decimals: 2 })} estimados
              </span>
            </p>
            <span aria-hidden="true" className="font-display text-[2rem] font-black leading-none text-ink/25">
              {i + 1}
            </span>
          </div>
          <div>
            <p className="font-bold leading-snug">
              {p.institution_slug ? (
                <Link href={`/instituciones/${p.institution_slug}`} className="text-ink underline decoration-2 underline-offset-4">
                  {p.institution_name ?? p.institution_acronym}
                </Link>
              ) : (
                (p.institution_name ?? "Institución sin dato")
              )}
            </p>
            <h3 className="mt-1 text-[1.0625rem] font-normal leading-snug">
              <Link href={`/compras/${encodeURIComponent(p.code)}`} className="text-ink underline decoration-1 underline-offset-4 hover:bg-yellow-soft">
                {truncate(sentenceCase(p.title) || p.code, 150)}
              </Link>
            </h3>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2 text-sm">
            {isException(p.modality) ? (
              <Pill tone="red" icon={false}>Por excepción, sin licitación pública</Pill>
            ) : (
              p.modality && <Pill tone="muted" icon={false}>{p.modality}</Pill>
            )}
            {p.status && <Pill tone="navy" icon={false}>{sentenceCase(p.status)}</Pill>}
            {p.has_alert && <Pill tone="amber" icon={false}>Tiene alerta del Radar</Pill>}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {p.published_at && <span>Publicado el {formatDate(p.published_at)}</span>}
            {p.official_url && <ExternalA href={p.official_url}>Ver en el portal de la DGCP</ExternalA>}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* ───────────────────────── El caso del mes ───────────────────────── */

const isCancelled = (s: string | null) => /(cancelad|desiert|suspendid|anulad)/i.test(s ?? "");

function CaseReason({ pick }: { pick: CasePick }) {
  const recent = Number(pick.recent_amount);
  if (pick.reason === "manual") return <>Tema destacado por la administración del sitio.</>;
  if (!recent) return <>En los últimos 30 días no se publicaron procesos nuevos de este tema.</>;
  const avg = pick.monthly_avg ? Number(pick.monthly_avg) : 0;
  const times = avg >= 1_000_000 ? recent / avg : null;
  return (
    <>
      {pick.reason === "auto" ? "Este tema se elige solo: es el que más creció frente a su promedio. " : ""}
      En los últimos 30 días se publicaron <Fig>{formatMoney(recent, "DOP", { compact: true })}</Fig> en{" "}
      <Fig>{formatNumber(pick.recent_processes)}</Fig> {pick.recent_processes === 1 ? "proceso" : "procesos"}
      {pick.reason === "auto" &&
        (times !== null && times >= 1.5 ? (
          <>
            , <Fig>{formatNumber(times, times >= 10 ? 0 : 1)}</Fig> veces su promedio mensual
          </>
        ) : times === null ? (
          ", cuando el resto del año casi no hubo compras de este tema"
        ) : (
          ""
        ))}
      .
    </>
  );
}

async function CaseOfTheMonth({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  if (!dbConfigured()) return null;
  const sp = await searchParams;
  const requested = typeof sp.caso === "string" && CASES[sp.caso] ? sp.caso : null;
  let pick: CasePick | null;
  let data: CaseData | null;
  try {
    pick = requested ? await getCaseRecent(requested) : await pickCaseOfMonth();
    data = pick ? await getCase(pick.slug) : null;
  } catch (e) {
    console.error("[caso del mes]", e);
    return null;
  }
  if (!pick || !data || data.totals.processes === 0) return null;
  const { config, processes, unitPrices, unitMedian, totals } = data;
  const biggest = processes[0];
  const maxUnit = Math.max(...unitPrices.map((u) => Number(u.unit_price)), 1);
  const median = unitMedian ? Number(unitMedian.value) : null;
  const others = CASE_SLUGS.filter((s) => s !== config.slug);
  return (
    <section aria-labelledby="caso-titulo" id="caso" className="on-yellow scroll-mt-28 border-b-[3px] border-ink bg-yellow">
      <div className="container-page py-12 md:py-16">
        <p className="kicker kicker-ink">{pick.reason === "elegido" ? "Tema que vigilamos" : "El caso del mes"}</p>
        <h2 id="caso-titulo" className="display-2 mt-3 max-w-4xl">
          {config.headline}
        </h2>
        <p className="mt-3 max-w-2xl text-lg">
          {config.intro} Esto es lo que aparece en el portal de Compras Dominicana.
        </p>
        <p className="mt-3 max-w-2xl text-lg">
          <CaseReason pick={pick} />
        </p>

        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="border-[3px] border-ink bg-white p-4">
            <dt className="text-sm font-bold uppercase tracking-wide">
              Monto estimado{totals.since ? ` desde ${formatDate(totals.since, "short")}` : ""}
            </dt>
            <dd className="mt-1 font-display text-[2.5rem] font-black leading-none tabular">
              {formatMoney(totals.amount, "DOP", { compact: true })}
            </dd>
          </div>
          <div className="border-[3px] border-ink bg-white p-4">
            <dt className="text-sm font-bold uppercase tracking-wide">Procesos de compra</dt>
            <dd className="mt-1 font-display text-[2.5rem] font-black leading-none tabular">
              {formatNumber(totals.processes)}
              <span className="ml-2 font-sans text-base font-bold">en {formatNumber(totals.institutions)} instituciones</span>
            </dd>
          </div>
          {biggest && (
            <div className="border-[3px] border-ink bg-ink p-4 text-white">
              <dt className="text-sm font-bold uppercase tracking-wide text-yellow">El proceso más grande</dt>
              <dd className="mt-1">
                <span className="block font-display text-[2.5rem] font-black leading-none tabular">
                  {formatMoney(biggest.estimated_amount, biggest.currency, { compact: true })}
                </span>
                <span className="mt-1 block text-sm">
                  {biggest.institution_name ?? "Institución sin dato"}
                  {biggest.status ? ` · ${sentenceCase(biggest.status)}` : ""}
                </span>
              </dd>
            </div>
          )}
        </dl>

        <div className={`mt-8 grid gap-6 ${unitPrices.length > 0 ? "lg:grid-cols-2" : ""}`}>
          {unitPrices.length > 0 && (
            <div className="border-[3px] border-ink bg-white p-5">
              <h3 className="font-display text-[1.75rem] font-black uppercase leading-none">¿Cuánto costó cada {config.unitNoun}?</h3>
              <p className="mt-2 text-sm text-ink-muted">
                Los precios por unidad más altos que se contrataron, antes de impuestos. Lo que incluye cada{" "}
                {config.unitNoun} cambia según el pliego: revisa el contrato antes de comparar.
              </p>
              {median !== null && unitMedian && (
                <p className="mt-3 text-[0.9375rem]">
                  Precio típico: <Fig>{formatMoney(median, "DOP")}</Fig> por {config.unitNoun} (mediana de{" "}
                  {formatNumber(unitMedian.lines)} líneas de contrato).
                </p>
              )}
              <ul className="mt-4 grid gap-4">
                {unitPrices.map((u) => {
                  return (
                    <li key={`${u.contract_code}-${u.unit_price}-${u.quantity}`}>
                      <p className="font-bold leading-snug">{u.institution_name ?? "Institución sin dato"}</p>
                      <div className="mt-1 flex items-center gap-3">
                        <div aria-hidden="true" className="h-3 flex-1 border-2 border-ink bg-white">
                          <div className="times-fill h-full bg-red" style={{ width: `${((Number(u.unit_price) / maxUnit) * 100).toFixed(1)}%` }} />
                        </div>
                        <span className="shrink-0 font-display text-2xl font-black leading-none tabular">{formatMoney(u.unit_price, u.currency)}</span>
                      </div>
                      <p className="mt-1 text-sm text-ink-muted">
                        <Fig>{formatNumber(u.quantity)}</Fig> × «{truncate(sentenceCase(u.description), 70)}» ·{" "}
                        <Link href={`/contratos/${encodeURIComponent(u.contract_code)}`} className="font-bold text-ink underline">
                          {u.contract_code}
                        </Link>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="border-[3px] border-ink bg-white p-5">
            <h3 className="font-display text-[1.75rem] font-black uppercase leading-none">Los procesos más grandes</h3>
            <p className="mt-2 text-sm text-ink-muted">Monto estimado al abrir el proceso. Los cancelados no se suman al total.</p>
            <ul className={`mt-4 grid gap-x-8 divide-y-2 divide-ink/15 ${unitPrices.length > 0 ? "" : "md:grid-cols-2 md:divide-y-0"}`}>
              {processes.map((p) => (
                <li key={p.code} className="py-3 first:pt-0 last:pb-0">
                  <span className={`block font-display text-[1.75rem] font-black leading-none tabular ${isCancelled(p.status) ? "text-ink-muted line-through" : ""}`}>
                    {formatMoney(p.estimated_amount, p.currency, { compact: true })}
                  </span>
                  <p className="mt-1 font-bold leading-snug">{p.institution_name ?? "Institución sin dato"}</p>
                  <p className="mt-0.5 text-sm">
                    <Link href={`/compras/${encodeURIComponent(p.code)}`} className="text-ink underline underline-offset-4">
                      {truncate(sentenceCase(p.title) || p.code, 140)}
                    </Link>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    {p.status && <Pill tone={isCancelled(p.status) ? "muted" : "navy"} icon={false}>{sentenceCase(p.status)}</Pill>}
                    {p.official_url ? <ExternalA href={p.official_url}>Ver en la DGCP</ExternalA> : <span className="font-mono">{p.code}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/buscar?q=${encodeURIComponent(config.query)}`} className="btn btn-secondary">
            Ver todas las compras de {config.name.toLowerCase()} <ArrowRight aria-hidden="true" className="size-5" />
          </Link>
        </div>
        <nav aria-label="Otros temas que vigilamos" className="mt-8 border-t-2 border-ink/30 pt-6">
          <p className="font-bold">Otros temas que vigilamos</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {requested && (
              <li>
                <Link href="/#caso" scroll={false} className="inline-flex min-h-11 items-center border-2 border-ink bg-ink px-3 font-bold text-yellow no-underline">
                  El caso del mes
                </Link>
              </li>
            )}
            {others.map((slug) => (
              <li key={slug}>
                <Link
                  href={`/?caso=${slug}#caso`}
                  scroll={false}
                  className="inline-flex min-h-11 items-center border-2 border-ink bg-white px-3 font-bold text-ink no-underline hover:bg-yellow-soft"
                >
                  {CASES[slug].name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  );
}

/* ───────────────────────── Otras señales ───────────────────────── */

async function Signals() {
  await connection();
  if (!dbConfigured()) return null;
  let counts;
  try {
    counts = await alertTypeCounts();
  } catch {
    return <div className="mt-6"><ErrorState /></div>;
  }
  const rows = counts.filter((c) => c.alert_type !== "precio" && SIGNALS[c.alert_type]);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((c) => {
        const s = SIGNALS[c.alert_type];
        return (
          <li key={c.alert_type} className="card flex flex-col gap-2 p-5">
            <span className="font-display text-[3.25rem] font-black leading-none tabular text-red-text">{formatNumber(c.n)}</span>
            <h3 className="text-xl font-bold">{s.title}</h3>
            <p className="text-[0.9375rem]">{s.text}</p>
            <Link
              href={`/radar?tipo=${c.alert_type}`}
              className="mt-auto inline-flex min-h-12 items-center gap-1.5 font-bold text-navy underline"
            >
              Ver {c.n === 1 ? "la alerta" : `las ${formatNumber(c.n)} alertas`} <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
