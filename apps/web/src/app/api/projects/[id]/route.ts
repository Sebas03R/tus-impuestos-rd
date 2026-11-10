import { guard, handle, ok, problem } from "@/lib/api";
import { getProject } from "@/lib/queries/fiscal";

export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const raw = (await ctx.params).id;
    if (!/^\d{1,9}$/.test(raw)) return problem(400, "Identificador inválido");
    const d = await getProject(Number(raw));
    if (!d) return problem(404, "No encontrado");
    return ok(d, { source: "MapaInversiones" }, 3600);
  });
}
