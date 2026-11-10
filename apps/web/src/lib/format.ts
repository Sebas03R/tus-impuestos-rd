/** Formato de cifras, fechas y textos para es-DO. Desconocido ⇒ "Sin dato" (nunca 0). */

export const TZ = "America/Santo_Domingo";
export const SIN_DATO = "Sin dato";

export type AmountType =
  | "estimado"
  | "adjudicado"
  | "contratado"
  | "modificado"
  | "pagado"
  | "presupuestado"
  | "aprobado"
  | "vigente"
  | "ejecutado"
  | "devengado"
  | "oferta"
  | "presupuesto"
  | "referencia";

export const AMOUNT_TYPE_LABEL: Record<string, string> = {
  estimado: "Monto estimado",
  adjudicado: "Monto adjudicado",
  contratado: "Monto contratado",
  modificado: "Monto modificado",
  pagado: "Monto pagado",
  presupuestado: "Monto presupuestado",
  aprobado: "Presupuesto aprobado",
  vigente: "Presupuesto vigente",
  ejecutado: "Monto ejecutado",
  devengado: "Monto devengado",
  oferta: "Monto ofertado",
  presupuesto: "Valor del proyecto",
  referencia: "Precio de referencia",
};

const CURRENCY_PREFIX: Record<string, string> = { DOP: "RD$", USD: "US$", EUR: "€" };

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** RD$1,234,567.89 — usa separadores es-DO (coma para miles, punto decimal). */
export function formatMoney(
  value: unknown,
  currency: string | null | undefined = "DOP",
  opts: { decimals?: number; compact?: boolean } = {},
): string {
  const n = toNumber(value);
  if (n === null) return SIN_DATO;
  const code = (currency || "DOP").toUpperCase();
  const prefix = CURRENCY_PREFIX[code] ?? `${code} `;
  if (opts.compact && Math.abs(n) >= 1_000_000) {
    const units: [number, string][] = [
      [1e9, " mil millones"],
      [1e6, " millones"],
    ];
    for (const [div, word] of units) {
      if (Math.abs(n) >= div) {
        const v = n / div;
        const s = new Intl.NumberFormat("es-DO", { maximumFractionDigits: v < 100 ? 1 : 0 }).format(v);
        return `${prefix}${s}${word}`;
      }
    }
  }
  const decimals = opts.decimals ?? (Math.abs(n) >= 1000 && Number.isInteger(n) ? 0 : 2);
  const s = new Intl.NumberFormat("es-DO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
  return `${prefix}${s}`;
}

export function formatNumber(value: unknown, decimals = 0): string {
  const n = toNumber(value);
  if (n === null) return SIN_DATO;
  return new Intl.NumberFormat("es-DO", { maximumFractionDigits: decimals }).format(n);
}

export function formatPercent(value: unknown, decimals = 1): string {
  const n = toNumber(value);
  if (n === null) return SIN_DATO;
  const s = new Intl.NumberFormat("es-DO", { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n);
  return `${n > 0 ? "+" : ""}${s} %`;
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Fecha sin hora: se interpreta como día calendario (mediodía UTC evita saltos de zona).
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 6 de noviembre de 2026 (hora de Santo Domingo). */
export function formatDate(value: unknown, style: "long" | "short" = "long"): string {
  const d = asDate(value);
  if (!d) return SIN_DATO;
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: TZ,
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
  }).format(d);
}

/** 6 nov. 2026, 7:45 p. m. (AST) */
export function formatDateTime(value: unknown): string {
  const d = asDate(value);
  if (!d) return SIN_DATO;
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Día calendario en Santo Domingo en formato ISO (YYYY-MM-DD). */
export function isoDay(value: unknown): string | null {
  const d = asDate(value);
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts;
}

export function hoursSince(value: unknown, now: Date = new Date()): number | null {
  const d = asDate(value);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / 3_600_000;
}

export function relativeAge(value: unknown, now: Date = new Date()): string {
  const h = hoursSince(value, now);
  if (h === null) return SIN_DATO;
  if (h < 1) return "hace menos de una hora";
  if (h < 24) return `hace ${Math.floor(h)} ${Math.floor(h) === 1 ? "hora" : "horas"}`;
  const days = Math.floor(h / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

export function textOr(value: unknown, fallback = SIN_DATO): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s ? s : fallback;
}

/** Convierte "MAYÚSCULAS SOSTENIDAS" en texto legible sin tocar siglas cortas. */
export function sentenceCase(value: string | null | undefined): string {
  if (!value) return "";
  const letters = value.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, "");
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, "");
  if (letters.length < 12 || upper.length / letters.length < 0.85) return value;
  const lower = value.toLocaleLowerCase("es-DO");
  return lower.charAt(0).toLocaleUpperCase("es-DO") + lower.slice(1);
}

export function truncate(value: string | null | undefined, max = 180): string {
  if (!value) return "";
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).trimEnd()}…`;
}
