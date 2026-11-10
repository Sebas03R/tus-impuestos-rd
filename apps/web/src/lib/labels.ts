/** Etiquetas públicas en lenguaje sencillo. Nunca acusatorias. */

export const ALERT_TYPES = [
  "precio",
  "fraccionamiento",
  "competencia_limitada",
  "adjudicaciones_recurrentes",
  "incremento_contractual",
  "documentacion_insuficiente",
  "patron_temporal",
  "diferencia_etapas",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_TYPE_LABEL: Record<string, string> = {
  precio: "Posible diferencia de precio",
  fraccionamiento: "Posible fraccionamiento",
  competencia_limitada: "Competencia limitada",
  adjudicaciones_recurrentes: "Patrón de contratación inusual",
  incremento_contractual: "Incremento contractual",
  documentacion_insuficiente: "Documentación insuficiente",
  patron_temporal: "Patrón temporal inusual",
  diferencia_etapas: "Diferencia entre etapas",
};

export const ALERT_TYPE_SHORT: Record<string, string> = {
  precio: "Precio",
  fraccionamiento: "Fraccionamiento",
  competencia_limitada: "Competencia",
  adjudicaciones_recurrentes: "Concentración",
  incremento_contractual: "Incremento",
  documentacion_insuficiente: "Documentos",
  patron_temporal: "Patrón temporal",
  diferencia_etapas: "Etapas",
};

export type PublicLabel =
  | "revision_sugerida"
  | "revision_prioritaria"
  | "informacion_insuficiente"
  | "aclarada"
  | "sin_alerta_vigente";

export const PUBLIC_LABEL: Record<string, { text: string; tone: "red" | "amber" | "navy" | "green" | "muted" }> = {
  revision_prioritaria: { text: "Revisión prioritaria", tone: "red" },
  revision_sugerida: { text: "Revisión sugerida", tone: "amber" },
  informacion_insuficiente: { text: "Información insuficiente", tone: "navy" },
  aclarada: { text: "Aclarada", tone: "green" },
  sin_alerta_vigente: { text: "Sin alerta vigente", tone: "muted" },
};

export const ALERT_STATUS_LABEL: Record<string, string> = {
  publicada: "Publicada",
  interna: "En análisis interno",
  en_revision: "En revisión editorial",
  retirada: "Retirada",
  aclarada: "Aclarada",
};

export const EVIDENCE_GRADE: Record<string, { text: string; help: string }> = {
  A: { text: "Evidencia A", help: "Existe una referencia oficial directa y técnicamente equivalente." },
  B: {
    text: "Evidencia B",
    help: "Al menos el mínimo configurado de compras comparables, con baja dispersión de precios.",
  },
  C: { text: "Evidencia C", help: "Datos insuficientes para una conclusión; solo uso interno." },
};

export const ALERT_DISCLAIMER =
  "Esta alerta indica una situación que merece revisión. No demuestra por sí sola una irregularidad.";

export const INDEPENDENCE_NOTICE =
  "Tus Impuestos RD es una iniciativa independiente. No es un portal oficial del Gobierno dominicano.";

/** Etiquetas de métricas para alertas genéricas (no de precio). */
export const METRIC_LABEL: Record<string, string> = {
  item_description: "Artículo",
  unit: "Unidad de medida",
  quantity: "Cantidad",
  contracted_price: "Precio contratado por unidad",
  reference_price: "Precio de referencia por unidad",
  diff_unit: "Diferencia por unidad",
  diff_pct: "Diferencia porcentual",
  diff_total: "Diferencia total estimada",
  n_peers: "Compras comparables",
  n_institutions: "Instituciones distintas en la comparación",
  dispersion: "Dispersión de precios de referencia",
  window_from: "Comparaciones desde",
  window_to: "Comparaciones hasta",
  tax_assumption: "Tratamiento de impuestos",
  bids: "Ofertas registradas",
  n_bids: "Ofertas registradas",
  n_processes: "Procesos agrupados",
  total_amount: "Monto total agrupado",
  threshold: "Umbral vigente",
  threshold_amount: "Umbral vigente",
  window_days: "Ventana de días",
  share: "Participación del proveedor",
  supplier_share: "Participación del proveedor",
  contracts: "Contratos",
  n_contracts: "Contratos del proveedor",
  group_total: "Total contratado en la categoría",
  initial_amount: "Monto inicial",
  final_amount: "Monto final",
  increase_pct: "Incremento porcentual",
  increase_amount: "Incremento",
  estimated_amount: "Monto estimado",
  contracted_amount: "Monto contratado",
  stage_diff_pct: "Diferencia entre etapas",
  missing_documents: "Documentos no encontrados",
  ratio: "Proporción frente al promedio mensual",
  december_amount: "Monto adjudicado en diciembre",
  monthly_average: "Promedio mensual",
  regime: "Régimen legal aplicado",
  modality: "Modalidad",
  year: "Año",
  currency: "Moneda",
};

/** Métricas que son montos en dinero (para formatear como RD$). */
export const MONEY_METRICS = new Set([
  "contracted_price",
  "reference_price",
  "diff_unit",
  "diff_total",
  "total_amount",
  "threshold",
  "threshold_amount",
  "group_total",
  "initial_amount",
  "final_amount",
  "increase_amount",
  "estimated_amount",
  "contracted_amount",
  "december_amount",
  "monthly_average",
]);
export const PCT_METRICS = new Set(["diff_pct", "increase_pct", "stage_diff_pct"]);
export const RATIO_METRICS = new Set(["share", "supplier_share", "dispersion"]);

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  proceso: "Proceso de compra",
  contrato: "Contrato",
  institucion: "Institución",
  proveedor: "Proveedor",
  obra: "Obra o proyecto",
};

export const DATA_SOURCE_STATUS: Record<string, { text: string; tone: "green" | "amber" | "red" | "muted" }> = {
  activa: { text: "Funcionando", tone: "green" },
  degradada: { text: "Con fallas recientes", tone: "amber" },
  bloqueada: { text: "Sin acceso autorizado", tone: "red" },
  no_disponible: { text: "No disponible", tone: "muted" },
};

/** Etapas del recorrido de una compra (la "ruta del peso"). */
export const STAGES = [
  { key: "publicado", label: "Publicado", help: "La institución anuncia lo que quiere comprar." },
  { key: "ofertas", label: "Ofertas recibidas", help: "Las empresas presentan sus propuestas." },
  { key: "adjudicado", label: "Adjudicado", help: "La institución elige a quién comprarle." },
  { key: "contratado", label: "Contratado", help: "Se firma el contrato con el proveedor." },
  { key: "pagado", label: "Pagado", help: "El Estado paga. Solo lo mostramos si hay evidencia oficial." },
] as const;

export const MODALITY_HELP: Record<string, string> = {
  "Compras por Debajo del Umbral": "Compras de bajo monto con un procedimiento simplificado.",
  "Contratación Menor": "Compras de monto menor; se invita a varios proveedores.",
  "Comparación de Precios": "Se comparan cotizaciones de varios oferentes.",
  "Licitación Pública Nacional": "Convocatoria abierta a todos los proveedores del país.",
  "Licitación Pública Internacional": "Convocatoria abierta también a proveedores extranjeros.",
  "Licitación Restringida": "Solo participan proveedores invitados por su especialidad.",
  "Procesos de Excepción": "Casos previstos por la ley (urgencia, exclusividad, etc.) con reglas especiales.",
  "Subasta Inversa": "Los oferentes compiten bajando su precio en tiempo real.",
  "Sorteo de Obras": "Las obras se asignan por sorteo entre empresas calificadas.",
};
