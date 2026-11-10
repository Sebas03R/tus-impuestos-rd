import "server-only";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { dbConfigured } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { ipHash } from "@/lib/request";
import { DGCP_LICENSE_NOTE, siteUrl } from "@/lib/site";

/** Utilidades comunes de la API pública: errores RFC 7807, caché CDN, CSV y límite de uso. */

export function problem(status: number, title: string, detail?: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ type: "about:blank", title, status, detail, ...extra }), {
    status,
    headers: { "Content-Type": "application/problem+json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function cacheHeaders(seconds: number): Record<string, string> {
  const v = `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`;
  return { "Cache-Control": v, "CDN-Cache-Control": v, "Netlify-CDN-Cache-Control": `${v}, durable` };
}

export type Meta = Record<string, unknown> & { source?: string };

export function ok(data: unknown, meta: Meta = {}, seconds = 300) {
  const body = {
    data,
    meta: {
      source: meta.source ?? "Dirección General de Contrataciones Públicas (DGCP) — datos abiertos",
      license: DGCP_LICENSE_NOTE,
      generated_at: new Date().toISOString(),
      provider: "Tus Impuestos RD (iniciativa independiente, no oficial)",
      ...meta,
    },
  };
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cacheHeaders(seconds) },
  });
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Evita inyección de fórmulas al abrir el CSV en hojas de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csv(rows: Record<string, unknown>[], filename: string, source: string) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const lines = [
    `# Fuente: ${source}`,
    `# Obtenido de: ${siteUrl()} (Tus Impuestos RD, iniciativa independiente, no oficial)`,
    `# Fecha de generación: ${new Date().toISOString()}`,
    `# ${DGCP_LICENSE_NOTE}`,
    `# Los montos conservan su tipo (estimado, contratado, etc.) y su moneda; no los sume entre etapas.`,
    cols.join(","),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
  ];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      ...cacheHeaders(300),
    },
  });
}

/** Valida configuración y aplica un límite generoso por IP (consultas costosas). */
export async function guard(request: Request, opts: { expensive?: boolean } = {}): Promise<Response | null> {
  await connection(); // siempre en tiempo de solicitud: nunca consultar la base durante el build
  if (!dbConfigured()) return problem(503, "Servicio no disponible", "La base de datos no está configurada.");
  if (opts.expensive) {
    const ip =
      request.headers.get("x-nf-client-connection-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
    if (!(await rateLimit(`api:${ipHash(ip)}`, 120, 60))) {
      return new Response(JSON.stringify({ type: "about:blank", title: "Demasiadas solicitudes", status: 429 }), {
        status: 429,
        headers: { "Content-Type": "application/problem+json", "Retry-After": "60" },
      });
    }
  }
  return null;
}

export function wantsCsv(url: URL): boolean {
  return url.searchParams.get("format") === "csv";
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e); // señales internas de Next (prerender, redirect) no son errores
    console.error("[api]", e);
    return problem(500, "Error interno", "No se pudo completar la consulta.");
  }
}
