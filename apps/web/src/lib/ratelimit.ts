import "server-only";
import { getSql } from "@/lib/db";

/**
 * Límite de solicitudes por ventana fija, guardado en Postgres (tabla UNLOGGED rate_limit_buckets).
 * Devuelve true si la solicitud está permitida. Si la base falla, permite (no bloquea al ciudadano)
 * salvo en acciones sensibles, que deben pasar `failClosed`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, failClosed = false): Promise<boolean> {
  try {
    const sql = getSql();
    const [row] = await sql<{ count: number }[]>`
      insert into rate_limit_buckets (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limit_buckets.window_start < now() - make_interval(secs => ${windowSeconds})
                     then 1 else rate_limit_buckets.count + 1 end,
        window_start = case when rate_limit_buckets.window_start < now() - make_interval(secs => ${windowSeconds})
                            then now() else rate_limit_buckets.window_start end
      returning count`;
    return (row?.count ?? 0) <= limit;
  } catch {
    return !failClosed;
  }
}
