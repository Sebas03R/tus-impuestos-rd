import "server-only";
import postgres, { type Sql } from "postgres";

/**
 * Conexión de la web a PostgreSQL con el rol `web_app` (lectura general + escrituras mínimas).
 * En Supabase usar el pooler en MODO SESIÓN (puerto 5432). Verificado el 2026-11-09: el modo
 * transaccional (6543) pierde respuestas con el pipelining de `postgres` (consultas colgadas y
 * cancelaciones falsas por statement_timeout). Con pocas conexiones y cierre rápido por inactividad,
 * el modo sesión cabe en el límite del plan gratuito.
 */
declare global {
  var __tirdsSql: Sql | undefined;
}

export class DatabaseNotConfigured extends Error {
  constructor() {
    super("DATABASE_URL_WEB no está configurada");
  }
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_WEB);
}

export function getSql(): Sql {
  const url = process.env.DATABASE_URL_WEB;
  if (!url) throw new DatabaseNotConfigured();
  if (!globalThis.__tirdsSql) {
    const isLocal = /@(localhost|127\.0\.0\.1|db)[:/]/.test(url);
    globalThis.__tirdsSql = postgres(url, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? (isLocal ? 5 : 3)),
      idle_timeout: isLocal ? 20 : 5,
      max_lifetime: 60 * 5,
      connect_timeout: 10,
      ssl: isLocal ? false : "require",
      connection: { application_name: "tirds-web", statement_timeout: 15000 },
      onnotice: () => {},
      // Las columnas DATE se leen como texto "YYYY-MM-DD" (día calendario, sin zona horaria).
      types: {
        dateOnly: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      },
    });
  }
  return globalThis.__tirdsSql;
}
