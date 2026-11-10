import { guard, handle, ok, problem } from "@/lib/api";
import { getProcessByCode } from "@/lib/queries/processes";

export async function GET(request: Request, ctx: RouteContext<"/api/processes/[id]">) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  return handle(async () => {
    const code = decodeURIComponent((await ctx.params).id).slice(0, 120);
    const d = await getProcessByCode(code);
    if (!d) return problem(404, "No encontrado", `No existe el proceso ${code} en nuestra base.`);
    return ok(
      {
        ...d,
        notes: {
          amounts: "estimated_amount = monto estimado; contracts[].amount = monto contratado. No se suman entre etapas.",
          unit_price: "contract_items.unit_price es antes de impuestos y descuentos.",
          payments: "Vacío si no existe fuente oficial abierta de pagos.",
        },
      },
      {},
      600,
    );
  });
}
