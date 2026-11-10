import { cacheHeaders } from "@/lib/api";
import { openapiSpec } from "@/lib/openapi";

export async function GET() {
  return new Response(JSON.stringify(openapiSpec(), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...cacheHeaders(3600) },
  });
}
