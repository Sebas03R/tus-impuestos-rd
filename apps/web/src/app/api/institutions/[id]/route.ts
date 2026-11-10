import { guard, handle, ok, problem } from "@/lib/api";
import { getInstitution } from "@/lib/queries/entities";

export async function GET(request: Request, ctx: RouteContext<"/api/institutions/[id]">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const d = await getInstitution((await ctx.params).id.slice(0, 120));
    if (!d) return problem(404, "No encontrada", "No existe esa institución en nuestra base.");
    return ok(d, { amounts: "contracted_dop = suma de montos contratados en DOP; otras monedas se cuentan aparte." }, 1800);
  });
}
