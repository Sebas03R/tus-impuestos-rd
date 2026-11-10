import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/** IP del cliente (Netlify / proxies) convertida en hash: nunca se guarda la IP en claro. */
export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-nf-client-connection-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "desconocida";
  return ipHash(ip);
}

export function ipHash(ip: string): string {
  const salt = process.env.SESSION_SECRET ?? "tirds";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
