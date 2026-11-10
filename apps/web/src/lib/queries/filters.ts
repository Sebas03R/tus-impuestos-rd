import { z } from "zod";

/** Validación estricta de parámetros de búsqueda (compartida por páginas y API). */

const trimmed = z
  .string()
  .trim()
  .max(200)
  .transform((s) => (s === "" ? undefined : s));
const optInt = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().catch(undefined);
const optMoney = z.coerce.number().min(0).max(1e15).optional().catch(undefined);
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
const optBool = z
  .enum(["1", "0", "true", "false", "si", "no"])
  .transform((v) => v === "1" || v === "true" || v === "si")
  .optional()
  .catch(undefined);

export const ENTITY_TYPES = ["proceso", "contrato", "institucion", "proveedor", "obra"] as const;
export const SORTS = ["relevancia", "fecha", "monto"] as const;

export const searchSchema = z.object({
  q: trimmed.optional(),
  tipo: z.enum(ENTITY_TYPES).optional().catch(undefined),
  institucion: optInt(1, 2_000_000_000),
  proveedor: optInt(1, 2_000_000_000),
  desde: optDate,
  hasta: optDate,
  modalidad: trimmed.optional(),
  estado: trimmed.optional(),
  objeto: trimmed.optional(),
  familia: z
    .string()
    .regex(/^\d{8}$/)
    .optional()
    .catch(undefined),
  provincia: trimmed.optional(),
  moneda: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .catch(undefined),
  anio: optInt(2000, 2100),
  min: optMoney,
  max: optMoney,
  alertas: optBool,
  documentos: optBool,
  orden: z.enum(SORTS).optional().catch(undefined),
  pagina: optInt(1, 10_000),
  limite: optInt(1, 100),
});

export type SearchParams = z.infer<typeof searchSchema>;

/** Convierte URLSearchParams / searchParams de Next en objeto plano (primer valor). */
export function flattenParams(input: Record<string, string | string[] | undefined> | URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (input instanceof URLSearchParams) {
    for (const [k, v] of input) if (!(k in out)) out[k] = v;
    return out;
  }
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.length) out[k] = v[0];
  }
  return out;
}

export function parseSearch(input: Record<string, string | string[] | undefined> | URLSearchParams): SearchParams {
  const parsed = searchSchema.safeParse(flattenParams(input));
  return parsed.success ? parsed.data : {};
}

/** Construye un querystring conservando filtros (para paginación y enlaces). */
export function toQuery(params: Record<string, unknown>, overrides: Record<string, unknown> = {}): string {
  const merged = { ...params, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    qs.set(k, v === true ? "1" : String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const pageSchema = z.object({
  pagina: optInt(1, 10_000),
  limite: optInt(1, 100),
});
