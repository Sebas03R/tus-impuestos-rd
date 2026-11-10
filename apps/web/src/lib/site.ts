export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.URL || "http://localhost:3010";
  return raw.replace(/\/$/, "");
}

export const SITE_NAME = "Tus Impuestos RD";
export const SLOGAN = "El dinero es público. La información también.";
export const DGCP_LICENSE_NOTE =
  "Datos abiertos publicados por la Dirección General de Contrataciones Públicas (DGCP); reutilización sujeta a los términos del portal oficial.";
