import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "@/lib/db";

export type Role = "admin" | "editor" | "lector";
export const ROLE_RANK: Record<Role, number> = { lector: 1, editor: 2, admin: 3 };
export const SESSION_COOKIE = "tirds_admin";
const SESSION_HOURS = 8;

export type SessionUser = { id: number; email: string; name: string; role: Role };

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setIssuer("tirds")
    .setAudience("tirds-admin")
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "tirds", audience: "tirds-admin", algorithms: ["HS256"] });
    const role = payload.role as Role;
    if (!payload.sub || !ROLE_RANK[role]) return null;
    return { id: Number(payload.sub), email: String(payload.email), name: String(payload.name), role };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Sesión vigente; además confirma en la base que el usuario sigue activo y con el mismo rol. */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await verifySession(token);
  if (!s) return null;
  try {
    const [u] = await getSql()<{ role: Role; active: boolean }[]>`select role, active from admin_users where id = ${s.id}`;
    if (!u || !u.active) return null;
    return { ...s, role: u.role };
  } catch {
    return null;
  }
}

export async function requireRole(min: Role): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  if (ROLE_RANK[s.role] < ROLE_RANK[min]) redirect("/admin?error=permiso");
  return s;
}

/** Defensa adicional contra CSRF en mutaciones: el Origin debe coincidir con el Host. */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new Error("Origen no permitido");
}

export async function audit(actor: SessionUser | string, action: string, entity: string | null, entityId: string | null, details: Record<string, unknown>, ipHashValue?: string) {
  const label = typeof actor === "string" ? actor : `${actor.email} (${actor.role})`;
  await getSql()`
    insert into audit_logs (actor, action, entity, entity_id, details, ip_hash)
    values (${label}, ${action}, ${entity}, ${entityId}, ${getSql().json(details as never)}, ${ipHashValue ?? null})`;
}
