import { hash } from "@node-rs/argon2";
import postgres from "postgres";

export const E2E_ADMIN = { email: "e2e-admin@ejemplo.invalid", password: "clave-e2e-muy-larga-123" };
export const E2E_EDITOR = { email: "e2e-lector@ejemplo.invalid", password: "clave-e2e-lector-456" };

/** Crea usuarios de prueba SOLO en la base de demostración (rol propietario, no el de la web). */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL_OWNER ?? "postgres://tirds:tirds_local_only@localhost:54330/tirds_demo";
  if (!url.includes("tirds_demo")) throw new Error("Los usuarios de prueba solo se crean en tirds_demo");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const mode = await sql<{ mode: string }[]>`select value->>'mode' as mode from system_settings where key = 'data_mode'`;
    if (mode[0]?.mode !== "demo") throw new Error("La base no está marcada como demostración (data_mode=demo). Ejecuta ./scripts/seed-demo.sh");
    for (const [u, role] of [[E2E_ADMIN, "admin"], [E2E_EDITOR, "lector"]] as const) {
      const h = await hash(u.password, { algorithm: 2 });
      await sql`
        insert into admin_users (email, display_name, password_hash, role)
        values (${u.email}, ${"Prueba " + role}, ${h}, ${role})
        on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role, active = true,
          failed_attempts = 0, locked_until = null`;
    }
    await sql`delete from rate_limit_buckets where key like 'login:%' or key like 'correccion:%'`;
  } finally {
    await sql.end();
  }
}
