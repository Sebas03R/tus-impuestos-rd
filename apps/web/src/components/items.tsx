import { Fig } from "@/components/ui";
import { formatMoney, formatNumber, sentenceCase, SIN_DATO, truncate } from "@/lib/format";
import type { ContractItemRow, ProcurementItemRow } from "@/lib/queries/processes";

/** Artículos contratados: tabla en escritorio, tarjetas en celular. Precio unitario = antes de impuestos. */
export function ContractItems({ items }: { items: ContractItemRow[] }) {
  return (
    <>
      <div className="hidden relative overflow-x-auto md:block" tabIndex={0} role="region" aria-label="Tabla de artículos contratados (desplazable)">
        <table className="w-full text-left text-[0.9375rem]">
          <caption className="sr-only">Artículos contratados</caption>
          <thead>
            <tr className="border-b-2 border-line align-bottom">
              <th scope="col" className="py-2 pr-3">Artículo</th>
              <th scope="col" className="py-2 pr-3 text-right">Cantidad</th>
              <th scope="col" className="py-2 pr-3">Unidad</th>
              <th scope="col" className="py-2 pr-3 text-right">Precio unitario<br /><span className="text-sm font-normal text-ink-muted">antes de impuestos</span></th>
              <th scope="col" className="py-2 pr-3 text-right">ITBIS y otros</th>
              <th scope="col" className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-line align-top">
                <th scope="row" className="max-w-md py-3 pr-3 font-normal">
                  <span className="block font-bold">{sentenceCase(it.item_name) || SIN_DATO}</span>
                  {it.user_description && <span className="block text-sm text-ink-muted">{truncate(it.user_description, 260)}</span>}
                  <span className="block text-sm text-ink-muted">Contrato {it.contract_code}</span>
                </th>
                <td className="tabular py-3 pr-3 text-right">{formatNumber(it.quantity, 2)}</td>
                <td className="py-3 pr-3">{it.unit ?? SIN_DATO}</td>
                <td className="tabular py-3 pr-3 text-right">{formatMoney(it.unit_price, it.currency, { decimals: 2 })}</td>
                <td className="tabular py-3 pr-3 text-right">{taxes(it)}</td>
                <td className="py-3 text-right"><Fig>{formatMoney(it.total, it.currency, { decimals: 2 })}</Fig></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">
        {items.map((it) => (
          <li key={it.id} className="border-2 border-ink p-4">
            <p className="font-bold">{sentenceCase(it.item_name) || SIN_DATO}</p>
            {it.user_description && <p className="text-sm text-ink-muted">{truncate(it.user_description, 200)}</p>}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.9375rem]">
              <dt className="text-ink-muted">Cantidad</dt>
              <dd className="tabular text-right">{formatNumber(it.quantity, 2)} {it.unit ?? ""}</dd>
              <dt className="text-ink-muted">Precio unitario (sin impuestos)</dt>
              <dd className="tabular text-right">{formatMoney(it.unit_price, it.currency, { decimals: 2 })}</dd>
              <dt className="text-ink-muted">ITBIS y otros</dt>
              <dd className="tabular text-right">{taxes(it)}</dd>
              <dt className="font-bold">Total</dt>
              <dd className="text-right"><Fig>{formatMoney(it.total, it.currency, { decimals: 2 })}</Fig></dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function taxes(it: ContractItemRow): string {
  const a = it.itbis === null ? null : Number(it.itbis);
  const b = it.other_taxes === null ? null : Number(it.other_taxes);
  if (a === null && b === null) return SIN_DATO;
  return formatMoney((a ?? 0) + (b ?? 0), it.currency, { decimals: 2 });
}

export function ProcessItems({ items, currency }: { items: ProcurementItemRow[]; currency: string | null }) {
  return (
    <div>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="border-2 border-ink p-4">
            <p className="font-bold">{sentenceCase(it.item_name) || SIN_DATO}</p>
            {it.user_description && <p className="text-sm text-ink-muted">{truncate(it.user_description, 220)}</p>}
            <p className="tabular mt-1 text-[0.9375rem]">
              {formatNumber(it.quantity, 2)} {it.unit ?? ""} · Precio unitario estimado{" "}
              {formatMoney(it.unit_price_estimated, currency, { decimals: 2 })} · Total estimado{" "}
              <Fig>{formatMoney(it.total_estimated, currency, { decimals: 2 })}</Fig>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

