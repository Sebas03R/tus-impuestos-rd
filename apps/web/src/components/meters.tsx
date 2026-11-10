import { formatMoney, formatNumber, toNumber } from "@/lib/format";

/**
 * Medidores de sobreprecio. Escala logarítmica de ×1 a ×5 (el motor no publica diferencias
 * mayores a +400 %), con las mismas bandas que usa el Radar: hasta +30 % no se publica,
 * +30 % a +60 % es "revisión sugerida" y más de +60 % es "revisión prioritaria".
 */
const MAX_TIMES = 5;
const BANDS = [
  { from: 1, to: 1.3, color: "var(--color-gauge-ok)", label: "Hasta ×1.3: no se publica" },
  { from: 1.3, to: 1.6, color: "var(--color-yellow)", label: "×1.3 a ×1.6: revisión sugerida" },
  { from: 1.6, to: MAX_TIMES, color: "var(--color-red)", label: "Más de ×1.6: revisión prioritaria" },
];
const TICKS = [1, 1.5, 2, 3, 5];

export function timesFromPct(diffPct: unknown): number | null {
  const n = toNumber(diffPct);
  return n === null ? null : 1 + n / 100;
}

/** 1.9975 → "2.0" (siempre un decimal, separadores es-DO). */
export function formatTimes(times: number): string {
  return new Intl.NumberFormat("es-DO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(times);
}

/** "el doble del precio típico", "el triple del precio típico" o "4.9 veces el precio típico". */
export function timesPhrase(times: number): string {
  const near = (v: number) => Math.abs(times - v) < 0.05;
  if (near(2)) return "el doble del precio típico";
  if (near(3)) return "el triple del precio típico";
  if (near(4)) return "el cuádruple del precio típico";
  return `${formatTimes(times)} veces el precio típico`;
}

/** "unidades" → "unidad", "cajas de 11" → "caja de 11", "kilogramos" → "kilo". */
export function unitSingular(unit: string | null | undefined): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return "unidad";
  if (u === "unidades") return "unidad";
  if (u === "kilogramos") return "kilo";
  if (u === "metros cúbicos") return "metro cúbico";
  const m = u.match(/^([a-záéíóúñ]+?)s( de \d+)?$/);
  return m ? `${m[1]}${m[2] ?? ""}` : u;
}

function position(times: number): number {
  const t = Math.log(Math.max(1, Math.min(times, MAX_TIMES))) / Math.log(MAX_TIMES);
  return Math.max(0, Math.min(1, t));
}

const CX = 130;
const CY = 126;
const R = 100;

function point(t: number, r = R): [number, number] {
  const a = Math.PI * t;
  return [CX - r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(t0: number, t1: number): string {
  const [x0, y0] = point(t0);
  const [x1, y1] = point(t1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * Sobreprecímetro: aguja sobre un arco de ×1 a ×5. La cifra y su explicación van en texto
 * (el dibujo es decorativo para lectores de pantalla y no depende del color).
 */
export function PriceGauge({ diffPct, size = "lg" }: { diffPct: unknown; size?: "lg" | "md" }) {
  const times = timesFromPct(diffPct);
  if (times === null) return null;
  const t = position(times);
  return (
    <figure className={`gauge ${size === "lg" ? "max-w-[26rem]" : "max-w-[18rem]"} w-full`}>
      <svg viewBox="0 0 260 150" aria-hidden="true" focusable="false" className="block w-full overflow-visible">
        <path d={arc(0, 1)} stroke="var(--color-ink)" strokeWidth="30" fill="none" />
        {BANDS.map((b) => (
          <path
            key={b.from}
            d={arc(position(b.from), position(b.to))}
            stroke={b.color}
            strokeWidth="24"
            fill="none"
          />
        ))}
        {TICKS.map((v) => {
          const tt = position(v);
          const [x0, y0] = point(tt, R - 17);
          const [x1, y1] = point(tt, R + 17);
          const [lx, ly] = point(tt, R + 31);
          return (
            <g key={v}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-ink)" strokeWidth="3" />
              <text
                x={lx}
                y={ly + 5}
                textAnchor="middle"
                className="fill-ink font-display text-[15px] font-extrabold"
              >
                ×{formatNumber(v, 1)}
              </text>
            </g>
          );
        })}
        <g className="gauge-needle" style={{ ["--needle" as string]: `${(t * 180).toFixed(2)}deg` }}>
          <path d={`M ${CX} ${CY - 6} L ${CX - R + 10} ${CY} L ${CX} ${CY + 6} Z`} fill="var(--color-ink)" />
        </g>
        <circle cx={CX} cy={CY} r="13" fill="var(--color-ink)" />
        <circle cx={CX} cy={CY} r="5" fill="var(--color-yellow)" />
      </svg>
    </figure>
  );
}

/** Barra horizontal con la misma escala del medidor. */
export function TimesBar({ diffPct }: { diffPct: unknown }) {
  const times = timesFromPct(diffPct);
  if (times === null) return null;
  const t = position(times);
  return (
    <div aria-hidden="true" className="relative h-4 w-full border-2 border-ink bg-white">
      <div
        className="times-fill absolute inset-y-0 left-0 bg-red"
        style={{ width: `${Math.max(2, t * 100).toFixed(1)}%` }}
      />
      {[2, 3].map((v) => (
        <span key={v} className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${(position(v) * 100).toFixed(1)}%` }} />
      ))}
    </div>
  );
}

/** Dos etiquetas de góndola: lo que pagaron otros (amarilla) y lo que pagó esta institución (roja). */
export function PriceTags({
  paid,
  reference,
  currency,
  unit,
  payer,
  peers,
  institutions,
}: {
  paid: unknown;
  reference: unknown;
  currency: string | null;
  unit: string | null;
  payer: string;
  peers?: number | null;
  institutions?: number | null;
}) {
  const per = unitSingular(unit);
  const perLb = (v: unknown) => {
    const n = toNumber(v);
    return n === null ? null : formatMoney(n * 0.45359237, currency, { decimals: 2 });
  };
  const kilo = per === "kilo";
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
      <div className="price-tag price-tag-ref">
        <span className="text-[0.8125rem] font-bold uppercase tracking-wide">Lo que pagaron otros</span>
        <span className="font-display text-[2.25rem] font-black leading-none tabular">{formatMoney(reference, currency)}</span>
        <span className="text-sm">
          por {per}
          {kilo && perLb(reference) ? ` (${perLb(reference)} la libra)` : ""}
          {peers ? ` · precio típico de ${formatNumber(peers)} compras${institutions ? ` en ${formatNumber(institutions)} instituciones` : ""}` : ""}
        </span>
      </div>
      <div className="price-tag price-tag-paid">
        <span className="text-[0.8125rem] font-bold uppercase tracking-wide">Lo que pagó {payer}</span>
        <span className="font-display text-[2.25rem] font-black leading-none tabular">{formatMoney(paid, currency)}</span>
        <span className="text-sm">
          por {per}
          {kilo && perLb(paid) ? ` (${perLb(paid)} la libra)` : ""}
        </span>
      </div>
    </div>
  );
}

export function GaugeLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {BANDS.map((b) => (
        <li key={b.from} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3 border-2 border-ink" style={{ background: b.color }} />
          {b.label}
        </li>
      ))}
    </ul>
  );
}
