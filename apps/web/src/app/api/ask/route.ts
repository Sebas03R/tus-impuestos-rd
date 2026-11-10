import { z } from "zod";
import { guard, problem } from "@/lib/api";
import { getAIProvider } from "@/lib/ai/provider";
import { rateLimit } from "@/lib/ratelimit";
import { ipHash } from "@/lib/request";
import { toQuery } from "@/lib/queries/filters";

const body = z.object({ question: z.string().trim().min(3).max(500) });

/** Pregunta en lenguaje natural → filtros de búsqueda. Desactivado si no hay GEMINI_API_KEY. */
export async function POST(request: Request) {
  const ai = getAIProvider();
  if (!ai.enabled) return problem(404, "Función no disponible", "La búsqueda con IA no está activada en este sitio.");
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return problem(403, "Origen no permitido");
  const blocked = await guard(request);
  if (blocked) return blocked;
  const ip = request.headers.get("x-nf-client-connection-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const perIp = await rateLimit(`ai:${ipHash(ip)}`, 10, 60, true);
  const daily = await rateLimit("ai:dia", Number(process.env.AI_DAILY_LIMIT ?? 500), 86_400, true);
  if (!perIp || !daily) return problem(429, "Límite de uso alcanzado", "Intenta más tarde o usa el buscador normal.");
  let parsed;
  try {
    parsed = body.parse(await request.json());
  } catch {
    return problem(400, "Pregunta inválida", "Escribe una pregunta de entre 3 y 500 caracteres.");
  }
  try {
    const filters = await ai.questionToFilters(parsed.question);
    return Response.json(
      {
        filters,
        url: `/buscar${toQuery(filters)}`,
        note: "La IA solo propone filtros de búsqueda; los resultados y cifras salen de la base de datos de fuentes oficiales.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return problem(502, "El servicio de IA no respondió", "Usa el buscador normal.");
  }
}
