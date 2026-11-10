import { siteUrl } from "@/lib/site";

const page = [
  { name: "pagina", in: "query", schema: { type: "integer", minimum: 1 }, description: "Página (desde 1)" },
  { name: "limite", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Resultados por página (máx. 100)" },
];
const format = { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] }, description: "csv para descargar" };
const q = (d: string) => ({ name: "q", in: "query", schema: { type: "string", maxLength: 200 }, description: d });
const searchParams = [
  q("Texto a buscar (tolerante a tildes y errores de escritura)"),
  { name: "tipo", in: "query", schema: { type: "string", enum: ["proceso", "contrato", "institucion", "proveedor", "obra"] } },
  { name: "institucion", in: "query", schema: { type: "integer" } },
  { name: "proveedor", in: "query", schema: { type: "integer" } },
  { name: "desde", in: "query", schema: { type: "string", format: "date" } },
  { name: "hasta", in: "query", schema: { type: "string", format: "date" } },
  { name: "anio", in: "query", schema: { type: "integer" } },
  { name: "modalidad", in: "query", schema: { type: "string" } },
  { name: "estado", in: "query", schema: { type: "string" } },
  { name: "objeto", in: "query", schema: { type: "string", enum: ["Bienes", "Servicios", "Obras"] } },
  { name: "familia", in: "query", schema: { type: "string", pattern: "^\\d{8}$" }, description: "Familia UNSPSC (8 dígitos)" },
  { name: "provincia", in: "query", schema: { type: "string" } },
  { name: "moneda", in: "query", schema: { type: "string", pattern: "^[A-Z]{3}$" } },
  { name: "min", in: "query", schema: { type: "number", minimum: 0 } },
  { name: "max", in: "query", schema: { type: "number", minimum: 0 } },
  { name: "alertas", in: "query", schema: { type: "string", enum: ["1", "0"] } },
  { name: "documentos", in: "query", schema: { type: "string", enum: ["1", "0"] } },
  { name: "orden", in: "query", schema: { type: "string", enum: ["relevancia", "fecha", "monto"] } },
  ...page,
  format,
];
const idParam = (d: string) => [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: d }];
const envelope = {
  type: "object",
  properties: {
    data: {},
    meta: {
      type: "object",
      properties: {
        source: { type: "string" },
        license: { type: "string" },
        generated_at: { type: "string", format: "date-time" },
        page: { type: "integer" },
        limit: { type: "integer" },
        total: { type: "integer" },
      },
    },
  },
};
const responses = {
  "200": { description: "Correcto", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } }, "text/csv": {} } },
  "400": { $ref: "#/components/responses/Problem" },
  "404": { $ref: "#/components/responses/Problem" },
  "429": { $ref: "#/components/responses/Problem" },
  "503": { $ref: "#/components/responses/Problem" },
};
const get = (summary: string, parameters: unknown[] = [], description?: string) => ({ get: { summary, description, parameters, responses } });

export function openapiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "API pública de Tus Impuestos RD",
      version: "1.0.0",
      description:
        "Datos de compras públicas, presupuesto y obras de República Dominicana, sincronizados desde fuentes oficiales. Iniciativa independiente, no oficial. Los montos llevan siempre su tipo (estimado, contratado, etc.) y moneda; no deben sumarse entre etapas. Las alertas indican situaciones que merecen revisión y no demuestran irregularidades.",
      license: { name: "Datos sujetos a las condiciones de cada fuente oficial" },
    },
    servers: [{ url: siteUrl() }],
    paths: {
      "/api/search": get("Búsqueda unificada", searchParams),
      "/api/processes": get("Procesos de compra (monto estimado)", searchParams.filter((p) => p.name !== "tipo")),
      "/api/processes/{id}": get("Detalle de un proceso por código oficial", idParam("Código del proceso, p. ej. MINPRE-DAF-CM-2026-0049")),
      "/api/contracts": get("Contratos (monto contratado)", searchParams.filter((p) => p.name !== "tipo")),
      "/api/contracts/{id}": get("Detalle de un contrato por código oficial", idParam("Código del contrato")),
      "/api/institutions": get("Instituciones", [q("Nombre o siglas"), ...page, format]),
      "/api/institutions/{id}": get("Detalle de una institución", idParam("Slug o identificador")),
      "/api/suppliers": get("Proveedores con contratos", [q("Nombre o RNC"), ...page, format]),
      "/api/suppliers/{id}": get("Detalle de un proveedor", idParam("Identificador numérico")),
      "/api/alerts": get("Alertas publicadas del Radar", [
        { name: "tipo", in: "query", schema: { type: "string" } },
        { name: "etiqueta", in: "query", schema: { type: "string" } },
        ...page,
        format,
      ]),
      "/api/alerts/{id}": get("Detalle de una alerta", idParam("Identificador público de la alerta")),
      "/api/alerts/{id}/evidence": get("Evidencia y cálculos de una alerta", idParam("Identificador público de la alerta")),
      "/api/budget": get("Presupuesto por universo, sección y año", [
        { name: "universo", in: "query", schema: { type: "string" } },
        { name: "seccion", in: "query", schema: { type: "string" } },
        { name: "anio", in: "query", schema: { type: "integer" } },
        { name: "por", in: "query", schema: { type: "string", enum: ["sector", "institution", "function", "funding"] } },
      ]),
      "/api/projects": get("Obras y proyectos de inversión", [
        q("Nombre"),
        { name: "provincia", in: "query", schema: { type: "string" } },
        { name: "municipio", in: "query", schema: { type: "string" } },
        { name: "institucion", in: "query", schema: { type: "string" } },
        { name: "estado", in: "query", schema: { type: "string" } },
        { name: "sector", in: "query", schema: { type: "string" } },
        { name: "anio", in: "query", schema: { type: "integer" } },
        ...page,
        format,
      ]),
      "/api/projects/{id}": get("Detalle de un proyecto", idParam("Identificador numérico")),
      "/api/system/data-status": get("Estado de actualización de las fuentes"),
      "/api/methodology": get("Reglas versionadas y umbrales legales"),
      "/api/health": get("Salud del servicio"),
    },
    components: {
      schemas: {
        Envelope: envelope,
        Problem: {
          type: "object",
          description: "RFC 7807",
          properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" } },
        },
      },
      responses: {
        Problem: { description: "Error", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
      },
    },
  };
}
