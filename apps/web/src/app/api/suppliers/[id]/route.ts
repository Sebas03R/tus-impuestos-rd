import { guard, handle, ok, problem } from "@/lib/api";
import { getSupplier } from "@/lib/queries/entities";

export async function GET(request: Request, ctx: RouteContext<"/api/suppliers/[id]">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const raw = (await ctx.params).id;
    if (!/^\d{1,9}$/.test(raw)) return problem(400, "Identificador inválido", "Use el identificador numérico del proveedor.");
    const d = await getSupplier(Number(raw));
    if (!d) return problem(404, "No encontrado", "No existe ese proveedor en nuestra base.");
    return ok(d, {}, 1800);
  });
}
