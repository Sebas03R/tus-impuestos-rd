import { guard, handle, ok } from "@/lib/api";
import { getMethodology } from "@/lib/queries/fiscal";

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => ok(await getMethodology(), { source: "Tus Impuestos RD — reglas versionadas y umbrales oficiales citados" }, 3600));
}
