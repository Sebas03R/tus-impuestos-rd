"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertSameOrigin, audit, clearSessionCookie, getSession, requireRole, setSessionCookie, type Role } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getSql } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { clientIpHash } from "@/lib/request";

export type ActionState = { ok: boolean; message: string };

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 500);
  const ip = await clientIpHash();
  if (!(await rateLimit(`login:${ip}`, 10, 900, true))) {
    return { ok: false, message: "Demasiados intentos desde esta conexión. Espera 15 minutos." };
  }
  const generic = { ok: false, message: "Correo o contraseña incorrectos." };
  if (!email || !password) return generic;
  const sql = getSql();
  const [u] = await sql<{ id: number; email: string; display_name: string; password_hash: string; role: Role; active: boolean; failed_attempts: number; locked_until: Date | null }[]>`
    select id, email, display_name, password_hash, role, active, failed_attempts, locked_until from admin_users where email = ${email}`;
  if (!u || !u.active) {
    await audit("anónimo", "login_fallido", "admin_users", email, { motivo: "usuario inexistente o inactivo" }, ip);
    return generic;
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return { ok: false, message: "La cuenta está bloqueada temporalmente por intentos fallidos. Intenta más tarde." };
  }
  if (!(await verifyPassword(u.password_hash, password))) {
    const failures = u.failed_attempts + 1;
    await sql`
      update admin_users set failed_attempts = ${failures >= MAX_FAILURES ? 0 : failures},
        locked_until = ${failures >= MAX_FAILURES ? sql`now() + make_interval(mins => ${LOCK_MINUTES})` : null}
      where id = ${u.id}`;
    await audit("anónimo", "login_fallido", "admin_users", String(u.id), { intentos: failures }, ip);
    return generic;
  }
  await sql`update admin_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ${u.id}`;
  const user = { id: u.id, email: u.email, name: u.display_name, role: u.role };
  await setSessionCookie(user);
  await audit(user, "login", "admin_users", String(u.id), {}, ip);
  redirect("/admin");
}

export async function logout() {
  await assertSameOrigin();
  const s = await getSession();
  if (s) await audit(s, "logout", "admin_users", String(s.id), {});
  await clearSessionCookie();
  redirect("/admin/login");
}

const ALERT_STATUSES = ["publicada", "interna", "en_revision", "retirada", "aclarada"] as const;
const LABELS = ["revision_sugerida", "revision_prioritaria", "informacion_insuficiente", "aclarada", "sin_alerta_vigente"] as const;

export async function changeAlertStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const user = await requireRole("editor");
  const parsed = z
    .object({
      alert_id: z.coerce.number().int().positive(),
      status: z.enum(ALERT_STATUSES),
      label: z.enum(LABELS),
      reason: z.string().trim().min(10, "Explica el motivo (mínimo 10 caracteres).").max(1000),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;
  const sql = getSql();
  const [prev] = await sql<{ status: string; public_label: string; public_id: string }[]>`
    select status, public_label, public_id from alerts where id = ${d.alert_id}`;
  if (!prev) return { ok: false, message: "La alerta no existe." };
  await sql`update alerts set status = ${d.status}, public_label = ${d.label} where id = ${d.alert_id}`;
  await sql`
    insert into alert_status_history (alert_id, from_status, to_status, from_label, to_label, reason, actor)
    values (${d.alert_id}, ${prev.status}, ${d.status}, ${prev.public_label}, ${d.label}, ${d.reason}, ${user.email})`;
  await audit(user, "alerta_cambio_estado", "alerts", prev.public_id, { de: prev.status, a: d.status, etiqueta: d.label, motivo: d.reason });
  revalidatePath("/admin/alertas");
  return { ok: true, message: `Alerta ${prev.public_id} actualizada.` };
}

export async function createRuleVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const user = await requireRole("admin");
  const code = String(formData.get("code") ?? "").slice(0, 40);
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  let params: unknown;
  try {
    params = JSON.parse(String(formData.get("params") ?? ""));
  } catch {
    return { ok: false, message: "Los parámetros deben ser JSON válido." };
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) return { ok: false, message: "Los parámetros deben ser un objeto JSON." };
  if (note.length < 10) return { ok: false, message: "Describe el cambio (mínimo 10 caracteres)." };
  const sql = getSql();
  const [cur] = await sql<{ version: number; name: string; public_description: string; technical_description: string; params: Record<string, unknown> }[]>`
    select version, name, public_description, technical_description, params from detection_rules
    where code = ${code} order by version desc limit 1`;
  if (!cur) return { ok: false, message: "Regla desconocida." };
  // Solo se permiten las claves que ya existen (evita parámetros que el motor no entiende).
  const unknown = Object.keys(params as object).filter((k) => !(k in cur.params));
  if (unknown.length) return { ok: false, message: `Parámetros no reconocidos: ${unknown.join(", ")}` };
  const merged = { ...cur.params, ...(params as object) };
  await sql`
    insert into detection_rules (code, version, name, public_description, technical_description, params, active, publishable, created_by, change_note)
    values (${code}, ${cur.version + 1}, ${cur.name}, ${cur.public_description}, ${cur.technical_description},
            ${sql.json(merged as never)}, true, true, ${user.email}, ${note})`;
  await audit(user, "regla_nueva_version", "detection_rules", `${code}@${cur.version + 1}`, { antes: cur.params, despues: merged, nota: note });
  revalidatePath("/admin/reglas");
  return { ok: true, message: `Creada la versión ${cur.version + 1} de «${cur.name}». Se aplicará en el próximo análisis.` };
}

export async function updateCorrection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const user = await requireRole("editor");
  const parsed = z
    .object({
      id: z.coerce.number().int().positive(),
      status: z.enum(["recibida", "en_revision", "aceptada", "rechazada"]),
      resolution: z.string().trim().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const d = parsed.data;
  await getSql()`
    update correction_requests set status = ${d.status}, resolution = ${d.resolution || null}, handled_by = ${user.id}, handled_at = now()
    where id = ${d.id}`;
  await audit(user, "correccion_actualizada", "correction_requests", String(d.id), { estado: d.status });
  revalidatePath("/admin/correcciones");
  return { ok: true, message: "Solicitud actualizada." };
}

export async function triggerSync(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const user = await requireRole("admin");
  const workflow = String(formData.get("workflow") ?? "sync-dgcp.yml");
  if (!/^[a-z0-9-]+\.ya?ml$/.test(workflow)) return { ok: false, message: "Flujo inválido." };
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    return {
      ok: false,
      message: `No hay token de GitHub configurado. Ejecuta manualmente: gh workflow run ${workflow} --repo <usuario>/tus-impuestos-rd (o \`uv run tirds sync dgcp\` en el servidor).`,
    };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME || "main" }),
  });
  await audit(user, "sincronizacion_manual", "workflow", workflow, { http: res.status });
  return res.status === 204
    ? { ok: true, message: `Se solicitó la ejecución de ${workflow}. Revisa el estado en unos minutos.` }
    : { ok: false, message: `GitHub respondió ${res.status}. Revisa el token y el nombre del flujo.` };
}
