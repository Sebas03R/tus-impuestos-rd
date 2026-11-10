"use server";

import { z } from "zod";
import { getSql } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { clientIpHash } from "@/lib/request";

export type CorrectionState = { ok: boolean; message: string; errors?: Record<string, string> };

const schema = z.object({
  entity_type: z.enum(["proceso", "contrato", "alerta", "institucion", "proveedor", "obra", "otro"]),
  entity_ref: z.string().trim().min(2, "Indica el código, enlace o nombre del registro.").max(300),
  message: z.string().trim().min(20, "Describe el error o la aclaración con al menos 20 caracteres.").max(5000),
  evidence_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "El enlace debe empezar con https://")
    .optional(),
  requester_name: z.string().trim().max(120).optional(),
  requester_email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Escribe un correo válido o déjalo vacío.")
    .optional(),
});

export async function submitCorrection(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  // Campo trampa: las personas no lo ven; los robots lo llenan.
  if (String(formData.get("sitio_web") ?? "") !== "") {
    return { ok: true, message: "Recibimos tu solicitud. Gracias." };
  }
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, message: "Revisa los campos marcados.", errors };
  }
  const ip = await clientIpHash();
  if (!(await rateLimit(`correccion:${ip}`, 5, 3600, true))) {
    return { ok: false, message: "Has enviado varias solicitudes en poco tiempo. Intenta de nuevo en una hora." };
  }
  const d = parsed.data;
  try {
    const sql = getSql();
    await sql`
      insert into correction_requests (entity_type, entity_ref, requester_name, requester_email, message, evidence_url, ip_hash)
      values (${d.entity_type}, ${d.entity_ref}, ${d.requester_name || null}, ${d.requester_email || null}, ${d.message},
              ${d.evidence_url || null}, ${ip})`;
  } catch {
    return { ok: false, message: "No pudimos guardar tu solicitud en este momento. Intenta más tarde." };
  }
  return {
    ok: true,
    message: "Recibimos tu solicitud. La revisaremos y, si corresponde, corregiremos el registro y lo indicaremos en su historial.",
  };
}
