import "server-only";
import { cacheLife } from "next/cache";
import { getSql } from "@/lib/db";
import { getDataMode } from "@/lib/queries/system";

/**
 * Consultas de la portada: compras con mayor diferencia de precio frente a compras comparables
 * y casos emblemáticos. Todo sale de alertas publicadas por el motor (reglas deterministas) o de
 * registros oficiales; aquí no se calcula ningún indicador nuevo.
 */

export type InflatedRow = {
  public_id: string;
  public_label: string;
  item: string;
  unit: string | null;
  paid: string;
  reference: string;
  diff_pct: string;
  extra_total: string | null;
  purchases: number;
  n_institutions: number | null;
  n_peers: number | null;
  currency: string;
  event_date: Date | string | null;
  institution_name: string | null;
  institution_acronym: string | null;
  institution_slug: string | null;
};

export type InflationOverview = {
  alerts: number;
  extra_total: string;
  institutions: number;
  since: Date | string | null;
};

/** Total estimado pagado por encima del precio de referencia (suma de alertas de precio publicadas). */
export async function getInflationOverview(): Promise<InflationOverview> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [row] = await sql<InflationOverview[]>`
    select count(*)::int as alerts, coalesce(sum(amount_involved), 0)::text as extra_total,
           count(distinct institution_id)::int as institutions, min(event_date) as since
    from alerts
    where status = 'publicada' and alert_type = 'precio' and (${demo}::boolean or not is_demo)`;
  return row ?? { alerts: 0, extra_total: "0", institutions: 0, since: null };
}

/**
 * Ranking de compras con mayor diferencia de precio. Varias líneas del mismo artículo en la misma
 * institución (p. ej. un contrato por lote) se agrupan: se muestra la de mayor diferencia y se suma
 * la diferencia total estimada de todas.
 */
export async function topInflated(opts: { by?: "veces" | "dinero"; limit?: number } = {}): Promise<InflatedRow[]> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(opts.limit ?? 10, 50);
  return sql<InflatedRow[]>`
    with p as (
      select a.public_id, a.public_label, a.institution_id, a.currency, a.event_date, a.priority_score,
             a.metrics->>'item_description' as item,
             lower(coalesce(a.metrics->>'item_description', a.subject_key)) as item_key,
             a.metrics->>'unit' as unit,
             a.metrics->>'contracted_price' as paid,
             a.metrics->>'reference_price' as reference,
             (a.metrics->>'diff_pct')::numeric as diff_pct_n,
             a.amount_involved,
             (a.metrics->>'n_institutions')::int as n_institutions,
             (a.metrics->>'n_peers')::int as n_peers
      from alerts a
      where a.status = 'publicada' and a.alert_type = 'precio' and (${demo}::boolean or not a.is_demo)
        and a.metrics ? 'diff_pct' and a.metrics ? 'reference_price' and a.metrics ? 'contracted_price'
    ), g as (
      select distinct on (institution_id, item_key) *,
             count(*) over (partition by institution_id, item_key)::int as purchases,
             sum(amount_involved) over (partition by institution_id, item_key) as extra_sum
      from p
      order by institution_id, item_key, diff_pct_n desc, public_id
    )
    select g.public_id, g.public_label, coalesce(g.item, 'Artículo sin descripción') as item, g.unit, g.paid,
           g.reference, g.diff_pct_n::text as diff_pct, g.extra_sum::text as extra_total, g.purchases,
           g.n_institutions, g.n_peers, g.currency, g.event_date,
           i.name as institution_name, i.acronym as institution_acronym, i.slug as institution_slug
    from g left join institutions i on i.id = g.institution_id
    order by ${opts.by === "dinero" ? sql`g.extra_sum desc nulls last` : sql`g.diff_pct_n desc`}, g.public_id
    limit ${limit}`;
}

/** Compra destacada de la portada: la de mayor prioridad (combina diferencia, monto y calidad de evidencia). */
export async function featuredInflated(): Promise<InflatedRow | null> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [row] = await sql<InflatedRow[]>`
    select a.public_id, a.public_label, coalesce(a.metrics->>'item_description', 'Artículo sin descripción') as item,
           a.metrics->>'unit' as unit, a.metrics->>'contracted_price' as paid, a.metrics->>'reference_price' as reference,
           a.metrics->>'diff_pct' as diff_pct, a.amount_involved::text as extra_total, 1 as purchases,
           (a.metrics->>'n_institutions')::int as n_institutions, (a.metrics->>'n_peers')::int as n_peers,
           a.currency, a.event_date, i.name as institution_name, i.acronym as institution_acronym, i.slug as institution_slug
    from alerts a left join institutions i on i.id = a.institution_id
    where a.status = 'publicada' and a.alert_type = 'precio' and (${demo}::boolean or not a.is_demo)
      and a.metrics ? 'diff_pct' and a.metrics ? 'reference_price' and a.metrics ? 'contracted_price'
    order by (a.public_label = 'revision_prioritaria') desc, a.priority_score desc, a.amount_involved desc nulls last, a.public_id
    limit 1`;
  return row ?? null;
}

/* ───────────────────────── Casos que vigilamos ───────────────────────── */

export type CaseConfig = {
  slug: string;
  /** Nombre corto del tema (botones y listados). */
  name: string;
  /** Titular de la sección. */
  headline: string;
  /** Una frase, descriptiva y sin juicios, de qué se compra. */
  intro: string;
  /**
   * Consulta de texto completo (to_tsquery 'simple' con prefijos, sobre el título: peso A) que usa el índice GIN
   * de search_entries para preseleccionar procesos. Luego `pattern` afina sobre el título.
   */
  fts: string;
  /** Expresión regular (POSIX, sobre el título sin tildes y en minúsculas) que identifica el tema. */
  pattern: string;
  /**
   * Líneas de contrato que representan una unidad comparable (kit, canasta, galón…), buscadas en la
   * descripción y la unidad. Sin patrón no se muestra el precio por unidad (artículos muy distintos).
   */
  unitPattern: string | null;
  unitNoun: string;
  /** Cantidad mínima de la línea para contarla como compra al por mayor del artículo. */
  minQuantity: number;
  /** Texto para la búsqueda completa. */
  query: string;
};

const CASE_LIST: CaseConfig[] = [
  {
    slug: "uniformes-y-utiles",
    name: "Uniformes y útiles escolares",
    headline: "Uniformes, zapatos y mochilas escolares",
    intro: "Cada año escolar el Estado compra uniformes, zapatos, mochilas y útiles para estudiantes de escuelas públicas.",
    fts: "escol:*A & (uniform:*A | polo:*A | pantal:*A | zapat:*A | calzad:*A | camis:*A | mochil:*A | util:*A | kit:*A)",
    pattern: "(uniformes?|polo ?shirts?|pantalones|zapatos|calzados?|camisas?|mochilas?|utiles|kits?).{0,80}escolar",
    unitPattern: null,
    unitNoun: "unidad",
    minQuantity: 100,
    query: "uniformes escolares",
  },
  {
    slug: "habichuelas-con-dulce",
    name: "Habichuelas con dulce",
    headline: "Habichuelas con dulce, por cuenta del Estado",
    intro: "Cada Semana Santa, ayuntamientos e instituciones compran kits e ingredientes de habichuelas con dulce con dinero público.",
    fts: "habichuel:*A & dulc:*A",
    pattern: "habichuelas?.{0,12}dulce",
    unitPattern: "(kit|combo)",
    unitNoun: "kit",
    minQuantity: 50,
    query: "habichuelas con dulce",
  },
  {
    slug: "navidad",
    name: "Navidad",
    headline: "La Navidad del Estado",
    intro: "Canastas, decoración, fiestas y regalos navideños pagados con fondos públicos.",
    fts: "navid:*A",
    pattern: "navide|navidad",
    unitPattern: "^\\s*(canasta|caja navide|combo navide)",
    unitNoun: "canasta",
    minQuantity: 50,
    query: "navidad",
  },
  {
    slug: "juguetes",
    name: "Juguetes",
    headline: "Juguetes comprados por el Estado",
    intro: "Juguetes que compran instituciones públicas, sobre todo para el Día de Reyes.",
    fts: "juguet:*A",
    pattern: "juguetes?",
    unitPattern: null,
    unitNoun: "juguete",
    minQuantity: 50,
    query: "juguetes",
  },
  {
    slug: "publicidad",
    name: "Publicidad",
    headline: "Publicidad y propaganda pagadas por el Estado",
    intro: "Anuncios, pautas en medios y vallas que contratan las instituciones públicas.",
    fts: "publicid:*A | propagand:*A | publicitari:*A",
    pattern: "publicidad|propaganda|pautas? publicitari|espacios? publicitari|vallas? publicitari",
    unitPattern: null,
    unitNoun: "servicio",
    minQuantity: 1,
    query: "publicidad",
  },
  {
    slug: "fiestas",
    name: "Fiestas y celebraciones",
    headline: "Fiestas, carnavales y agasajos",
    intro: "Fiestas patronales, carnavales, agasajos y celebraciones organizadas con fondos públicos.",
    fts: "fiest:*A | festivid:*A | agasaj:*A | carnaval:*A | patronal:*A",
    pattern: "fiestas?|festividad|agasajo|carnaval|patronales",
    unitPattern: null,
    unitNoun: "evento",
    minQuantity: 1,
    query: "fiestas",
  },
  {
    slug: "vehiculos",
    name: "Vehículos",
    headline: "Camionetas, yipetas y otros vehículos",
    intro: "Vehículos que compra el Estado para sus instituciones.",
    fts: "vehicul:*A | camionet:*A | jeepet:*A | yipet:*A | automovil:*A | minibus:*A | autobus:*A",
    pattern: "(adquisicion|compra|suministro).{0,40}(vehiculos?|camionetas?|jeepetas?|yipetas?|automoviles?|minibus|autobuses)",
    unitPattern: null,
    unitNoun: "vehículo",
    minQuantity: 1,
    query: "camionetas",
  },
  {
    slug: "combustible",
    name: "Combustible",
    headline: "Combustible para el Estado",
    intro: "Gasoil y gasolina para la flota pública: uno de los gastos que más se repite.",
    fts: "combustib:*A | gasoil:*A | gasolin:*A",
    pattern: "combustibles?|gasoil|gasolina",
    unitPattern: null,
    unitNoun: "galón",
    minQuantity: 100,
    query: "combustible",
  },
  {
    slug: "comida-escolar",
    name: "Comida escolar",
    headline: "Raciones y comida escolar",
    intro: "Raciones del Programa de Alimentación Escolar y otras comidas que el Estado contrata para estudiantes de escuelas públicas.",
    fts: "(escol:*A | estudiant:*A | educativ:*A | inabie:*A) & (racion:*A | aliment:*A | desayun:*A | almuerz:*A)",
    pattern: "alimentacion escolar|desayuno escolar|almuerzo escolar|raciones?.{0,120}(escolar|estudiant|centros educativos)",
    unitPattern: null,
    unitNoun: "ración",
    minQuantity: 1000,
    query: "raciones alimentarias",
  },
  {
    slug: "refrigerios",
    name: "Refrigerios y catering",
    headline: "Refrigerios, buffet y catering",
    intro: "Refrigerios, picaderas, buffet y catering para actividades de instituciones públicas.",
    fts: "refriger:*A | catering:*A | buffet:*A | picader:*A | brindis:*A",
    pattern: "refrigerios?|catering|buffet|picaderas?|brindis",
    unitPattern: null,
    unitNoun: "refrigerio",
    minQuantity: 50,
    query: "refrigerios",
  },
  {
    slug: "flores",
    name: "Flores y coronas",
    headline: "Arreglos florales y coronas fúnebres",
    intro: "Arreglos florales, ofrendas y coronas fúnebres pagados por instituciones públicas.",
    fts: "floral:*A | (coron:*A & funebr:*A) | ofrend:*A",
    pattern: "arreglos? florales?|coronas? funebres?|ofrendas? florales?",
    unitPattern: "(arreglo|corona|ofrenda)",
    unitNoun: "arreglo",
    minQuantity: 5,
    query: "arreglos florales",
  },
  {
    slug: "bonos-y-tarjetas",
    name: "Bonos y tarjetas",
    headline: "Bonos y tarjetas de regalo",
    intro: "Bonos, vales y tarjetas de regalo o de alimentos que compran instituciones públicas.",
    fts: "(bono:*A | tarjet:*A | vale:*A) & (regal:*A | navid:*A | aliment:*A | compr:*A | canj:*A)",
    pattern: "(bonos?|tarjetas?|vales?) (de )?(regalo|navidad|alimentos?|compras?|canje)",
    unitPattern: null,
    unitNoun: "bono",
    minQuantity: 1,
    query: "bonos navideños",
  },
];

export const CASES: Record<string, CaseConfig> = Object.fromEntries(CASE_LIST.map((c) => [c.slug, c]));
export const CASE_SLUGS = CASE_LIST.map((c) => c.slug);

const CANCELLED = "(cancelad|desiert|suspendid|anulad)";
/** Piso para no premiar temas que casi no tienen historia: RD$10 millones al mes. */
const SURGE_FLOOR = 10_000_000;

type Sql = ReturnType<typeof getSql>;

/**
 * Procesos del tema, desde el índice de búsqueda (search_entries, una fila por proceso con su monto
 * estimado y fecha de publicación). El índice GIN preselecciona y la expresión regular afina sobre
 * el título, así la consulta tarda milisegundos en vez de recorrer todos los procesos.
 */
function caseWhere(sql: Sql, config: CaseConfig, demo: boolean) {
  return sql`s.entity_type = 'proceso'
    and public.si_tsv(s.title, s.ref_code, s.institution_name, s.supplier_name, s.body) @@ to_tsquery('simple', ${config.fts})
    and public.f_unaccent(lower(coalesce(s.title, ''))) ~ ${config.pattern}
    and (${demo}::boolean or not s.is_demo)`;
}

export type CasePick = {
  slug: string;
  /** "auto": el que más creció; "manual": fijado en system_settings.caso_destacado; "elegido": ?caso= en la URL. */
  reason: "auto" | "manual" | "elegido";
  recent_amount: string;
  recent_processes: number;
  monthly_avg: string | null;
  surge: number | null;
};

type CaseActivity = { slug: string; recent: number; recent_processes: number; prev: number };

async function caseActivity(sql: Sql, config: CaseConfig, demo: boolean): Promise<CaseActivity> {
  const [r] = await sql<{ recent_amount: string; recent_processes: number; prev_amount: string }[]>`
    select coalesce(sum(s.amount) filter (where s.event_date >= current_date - 30), 0)::text as recent_amount,
           (count(*) filter (where s.event_date >= current_date - 30))::int as recent_processes,
           coalesce(sum(s.amount) filter (where s.event_date < current_date - 30), 0)::text as prev_amount
    from search_entries s
    where ${caseWhere(sql, config, demo)}
      and s.event_date >= current_date - 395
      and coalesce(s.currency, 'DOP') = 'DOP'
      and coalesce(s.status, '') !~* ${CANCELLED}`;
  return {
    slug: config.slug,
    recent: Number(r?.recent_amount ?? 0),
    recent_processes: r?.recent_processes ?? 0,
    prev: Number(r?.prev_amount ?? 0),
  };
}

/**
 * Caso del mes: el tema vigilado cuyo monto nuevo de los últimos 30 días más supera su promedio
 * mensual anterior (hasta 12 meses). Así la portada cambia sola con la temporada: habichuelas en
 * Semana Santa, uniformes en el inicio del año escolar, Navidad en diciembre… Se puede fijar uno a
 * mano con `system_settings.caso_destacado` (valor: el slug).
 */
export async function pickCaseOfMonth(): Promise<CasePick | null> {
  "use cache";
  cacheLife("hours");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [[manual], [span], activity] = await Promise.all([
    sql<{ slug: string | null }[]>`
      select coalesce(value->>'slug', value #>> '{}') as slug from system_settings where key = 'caso_destacado'`,
    sql<{ months: string }[]>`
      select least(12, greatest(1, ((current_date - 30) - min(event_date)) / 30.44))::text as months
      from search_entries where entity_type = 'proceso' and event_date >= current_date - 395
        and (${demo}::boolean or not is_demo)`,
    Promise.all(CASE_LIST.map((c) => caseActivity(sql, c, demo))),
  ]);
  const months = Math.max(1, Number(span?.months) || 1);
  const scored = activity.map((a) => {
    const avg = a.prev / months;
    return { ...a, avg, surge: a.recent / (avg + SURGE_FLOOR) };
  });
  const toPick = (r: (typeof scored)[number], reason: CasePick["reason"]): CasePick => ({
    slug: r.slug,
    reason,
    recent_amount: r.recent.toFixed(2),
    recent_processes: r.recent_processes,
    monthly_avg: r.avg ? r.avg.toFixed(2) : null,
    surge: Number.isFinite(r.surge) ? Number(r.surge.toFixed(1)) : null,
  });
  const forced = manual?.slug ? scored.find((r) => r.slug === manual.slug) : undefined;
  if (forced) return toPick(forced, "manual");
  const candidates = scored.filter((r) => r.recent_processes >= 2 && r.recent >= 5_000_000);
  const pool = candidates.length ? candidates : scored.filter((r) => r.recent > 0);
  const best = pool.sort((a, b) => b.surge - a.surge)[0];
  return best ? toPick(best, "auto") : null;
}

/** Actividad reciente de un tema puntual (cuando llega ?caso= en la URL). */
export async function getCaseRecent(slug: string): Promise<CasePick | null> {
  "use cache";
  cacheLife("hours");
  const config = CASES[slug];
  if (!config) return null;
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const a = await caseActivity(sql, config, demo);
  return {
    slug,
    reason: "elegido",
    recent_amount: a.recent.toFixed(2),
    recent_processes: a.recent_processes,
    monthly_avg: null,
    surge: null,
  };
}

export type CaseProcess = {
  code: string;
  title: string | null;
  estimated_amount: string | null;
  currency: string | null;
  status: string | null;
  published_at: Date | null;
  official_url: string | null;
  institution_name: string | null;
  institution_slug: string | null;
};

export type CaseUnitPrice = {
  contract_code: string;
  official_url: string | null;
  institution_name: string | null;
  awarded_at: Date | null;
  description: string | null;
  unit: string | null;
  quantity: string;
  unit_price: string;
  currency: string | null;
};

export type CaseData = {
  config: CaseConfig;
  processes: CaseProcess[];
  unitPrices: CaseUnitPrice[];
  /** Mediana del precio por unidad de todas las líneas comparables (no solo las mostradas). */
  unitMedian: { value: string; lines: number } | null;
  totals: { processes: number; institutions: number; amount: string; cancelled: number; since: Date | string | null };
};

export async function getCase(slug: string): Promise<CaseData | null> {
  "use cache";
  cacheLife("hours");
  const config = CASES[slug];
  if (!config) return null;
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const where = caseWhere(sql, config, demo);
  const linesFrom = sql`
      from search_entries s
      join contracts c on c.process_id = s.entity_id
      join contract_items ci on ci.contract_id = c.id
      left join institutions i on i.id = c.institution_id
      where ${where}
        and ci.quantity >= ${config.minQuantity} and ci.unit_price > 0 and coalesce(c.currency, 'DOP') = 'DOP'
        and public.f_unaccent(lower(coalesce(ci.user_description, '') || ' ' || coalesce(ci.item_name, '') || ' ' || coalesce(ci.unit, ''))) ~ ${config.unitPattern ?? "^$"}`;
  const [[totals], processes, unitPrices, [median]] = await Promise.all([
    sql<{ processes: number; institutions: number; amount: string; cancelled: number; since: Date | string | null }[]>`
      select count(*)::int as processes, count(distinct s.institution_id)::int as institutions,
             coalesce(sum(s.amount) filter (
               where coalesce(s.status, '') !~* ${CANCELLED} and coalesce(s.currency, 'DOP') = 'DOP'), 0)::text as amount,
             (count(*) filter (where coalesce(s.status, '') ~* ${CANCELLED}))::int as cancelled,
             min(s.event_date) as since
      from search_entries s where ${where}`,
    sql<CaseProcess[]>`
      select p.code, p.title, p.estimated_amount::text, p.currency, p.status, p.published_at, p.official_url,
             i.name as institution_name, i.slug as institution_slug
      from search_entries s
      join procurement_processes p on p.id = s.entity_id
      left join institutions i on i.id = p.institution_id
      where ${where}
      order by p.estimated_amount desc nulls last, p.code
      limit 6`,
    config.unitPattern
      ? sql<CaseUnitPrice[]>`
          select c.code as contract_code, c.official_url, i.name as institution_name, c.awarded_at,
                 coalesce(ci.user_description, ci.item_name) as description, ci.unit,
                 ci.quantity::text, ci.unit_price::text, c.currency
          ${linesFrom}
          order by ci.unit_price desc
          limit 8`
      : Promise.resolve([] as CaseUnitPrice[]),
    config.unitPattern
      ? sql<{ value: string | null; lines: number }[]>`
          select percentile_cont(0.5) within group (order by ci.unit_price)::numeric(18,2)::text as value,
                 count(*)::int as lines
          ${linesFrom}`
      : Promise.resolve([{ value: null, lines: 0 }]),
  ]);
  return {
    config,
    processes,
    unitPrices,
    unitMedian: median?.value && median.lines >= 3 ? { value: median.value, lines: median.lines } : null,
    totals: totals ?? { processes: 0, institutions: 0, amount: "0", cancelled: 0, since: null },
  };
}

/* ───────────────────────── Lo más grande que se está comprando ───────────────────────── */

export type BigProcess = {
  code: string;
  title: string | null;
  estimated_amount: string;
  currency: string | null;
  status: string | null;
  modality: string | null;
  published_at: Date | null;
  official_url: string | null;
  institution_name: string | null;
  institution_acronym: string | null;
  institution_slug: string | null;
  has_alert: boolean;
};

/**
 * Procesos de compra más grandes publicados en los últimos `days` días, por monto estimado.
 * Se actualiza con cada sincronización: una licitación grande publicada hoy aparece aquí en la
 * siguiente corrida. Excluye cancelados, desiertos, suspendidos y anulados.
 */
export async function biggestRecentProcesses(opts: { days?: number; limit?: number } = {}): Promise<BigProcess[]> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const limit = Math.min(opts.limit ?? 8, 30);
  return sql<BigProcess[]>`
    select p.code, p.title, p.estimated_amount::text as estimated_amount, p.currency, p.status, p.modality,
           p.published_at, p.official_url, i.name as institution_name, i.acronym as institution_acronym,
           i.slug as institution_slug,
           exists (select 1 from alerts a where a.process_id = p.id and a.status = 'publicada') as has_alert
    from procurement_processes p left join institutions i on i.id = p.institution_id
    where p.published_at >= now() - make_interval(days => ${days})
      and p.estimated_amount > 0
      and (${demo}::boolean or not p.is_demo)
      and coalesce(p.status, '') !~* ${CANCELLED}
    order by p.estimated_amount desc, p.code
    limit ${limit}`;
}

/* ───────────────────────── Intentos de compra ───────────────────────── */

export type AttemptEvent = { at: string; amount?: [string | null, string | null]; status?: [string | null, string | null] };

export type FailedAttempt = {
  code: string;
  title: string | null;
  estimated_amount: string | null;
  /** Mayor monto estimado que vimos: si bajó, el de antes. */
  peak_amount: string;
  currency: string | null;
  status: string | null;
  modality: string | null;
  published_at: Date | null;
  official_url: string | null;
  institution_name: string | null;
  institution_slug: string | null;
  /** Cambios de monto o de estado observados entre sincronizaciones (antes, después). */
  events: AttemptEvent[] | null;
  /** Documentos oficiales del cambio: avisos de enmienda, adendas, actos de cancelación. */
  docs: { name: string; url: string }[] | null;
};

/**
 * Intentos de compra más altos: procesos que se cancelaron, quedaron desiertos o se suspendieron, y
 * procesos cuyo monto estimado bajó después de publicarse. El "antes y después" sale de
 * record_versions (el pipeline guarda cada cambio que observa entre sincronizaciones); lo anterior
 * a la primera vez que vimos el proceso no se conoce y no se inventa.
 */
export async function failedAttempts(
  opts: { by?: "monto" | "recientes"; days?: number; limit?: number } = {},
): Promise<FailedAttempt[]> {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const days = Math.min(Math.max(opts.days ?? 90, 7), 365);
  const limit = Math.min(opts.limit ?? 6, 24);
  return sql<FailedAttempt[]>`
    with hist as (
      select rv.entity_id as process_id,
             max(nullif(rv.changed_fields->'estimated_amount'->>0, '')::numeric) as prev_peak,
             max(rv.observed_at) as last_change,
             jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'at', rv.observed_at,
               'amount', rv.changed_fields->'estimated_amount',
               'status', rv.changed_fields->'status')) order by rv.observed_at) as events
      from record_versions rv
      where rv.entity = 'process' and rv.changed_fields ?| array['estimated_amount', 'status']
      group by rv.entity_id
    ), p as (
      select p.*, h.events, h.last_change, greatest(p.estimated_amount, coalesce(h.prev_peak, 0)) as peak
      from procurement_processes p left join hist h on h.process_id = p.id
      where p.published_at >= now() - make_interval(days => ${days})
        and (${demo}::boolean or not p.is_demo)
        and coalesce(p.currency, 'DOP') = 'DOP'
        and (coalesce(p.status, '') ~* ${CANCELLED} or coalesce(h.prev_peak, 0) > p.estimated_amount)
    )
    select p.code, p.title, p.estimated_amount::text, p.peak::text as peak_amount, p.currency, p.status, p.modality,
           p.published_at, p.official_url, i.name as institution_name, i.slug as institution_slug, p.events,
           (select jsonb_agg(jsonb_build_object('name', d.name, 'url', d.url) order by d.uploaded_at desc nulls last)
              from (select * from source_documents d
                    where d.process_id = p.id
                      and public.f_unaccent(lower(d.name)) ~ '(enm[a-z]*da|adenda|cancela|desiert|suspen|anula)'
                    order by d.uploaded_at desc nulls last limit 3) d) as docs
    from p left join institutions i on i.id = p.institution_id
    where p.peak > 0
    order by ${opts.by === "recientes" ? sql`coalesce(p.last_change, p.published_at) desc` : sql`p.peak desc`}, p.code
    limit ${limit}`;
}
