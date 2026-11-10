import { guard, handle, ok, problem } from "@/lib/api";
import { getContractByCode } from "@/lib/queries/processes";

export async function GET(request: Request, ctx: RouteContext<"/api/contracts/[id]">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const code = decodeURIComponent((await ctx.params).id).slice(0, 120);
    const c = await getContractByCode(code);
    if (!c) return problem(404, "No encontrado", `No existe el contrato ${code} en nuestra base.`);
    return ok(c, { amount_type: "contratado" }, 600);
  });
}
