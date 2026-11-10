import type { ReactNode } from "react";

/**
 * Gráficos livianos y accesibles (SVG/HTML sin librerías). Una sola serie por gráfico,
 * un solo eje, color único (navy) para magnitud, valores en tinta de texto y siempre
 * con una tabla equivalente.
 */

export type Datum = { label: string; value: number | null; display: string; href?: string; note?: string };

export function BarList({
  title,
  data,
  valueLabel,
  caption,
}: {
  title: string;
  data: Datum[];
  valueLabel: string;
  caption?: ReactNode;
}) {
  const max = Math.max(1, ...data.map((d) => d.value ?? 0));
  return (
    <figure className="w-full">
      <figcaption className="mb-3">
        <span className="block font-bold text-navy-deep">{title}</span>
        {caption && <span className="block text-sm text-ink-muted">{caption}</span>}
      </figcaption>
      <ul className="space-y-3">
        {data.map((d) => {
          const pct = d.value === null ? 0 : Math.max(0.5, (d.value / max) * 100);
          const label = d.href ? (
            <a href={d.href} className="font-bold text-navy underline">
              {d.label}
            </a>
          ) : (
            <span className="font-bold">{d.label}</span>
          );
          return (
            <li key={d.label} className="grid gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 break-words">{label}</span>
                <span className="tabular text-[0.9375rem] font-bold text-ink">{d.display}</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-mist" aria-hidden="true">
                <div className="h-2.5 rounded-full bg-navy" style={{ width: `${pct}%` }} title={`${d.label}: ${d.display}`} />
              </div>
              {d.note && <span className="text-sm text-ink-muted">{d.note}</span>}
            </li>
          );
        })}
      </ul>
      <DataTable caption={`${title} (tabla)`} columns={["Elemento", valueLabel]} rows={data.map((d) => [d.label, d.display])} />
    </figure>
  );
}

export function ColumnChart({
  title,
  data,
  valueLabel,
  caption,
}: {
  title: string;
  data: Datum[];
  valueLabel: string;
  caption?: ReactNode;
}) {
  const max = Math.max(1, ...data.map((d) => d.value ?? 0));
  const W = 640;
  const H = 220;
  const pad = { top: 16, bottom: 34, left: 8, right: 8 };
  const bw = (W - pad.left - pad.right) / Math.max(1, data.length);
  const gap = Math.min(10, bw * 0.25);
  return (
    <figure className="w-full">
      <figcaption className="mb-3">
        <span className="block font-bold text-navy-deep">{title}</span>
        {caption && <span className="block text-sm text-ink-muted">{caption}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. Los valores están en la tabla siguiente.`}>
        <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="#D5DEE8" strokeWidth="1" />
        {data.map((d, i) => {
          const h = d.value === null ? 0 : ((H - pad.top - pad.bottom) * d.value) / max;
          const x = pad.left + i * bw + gap / 2;
          const y = H - pad.bottom - h;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${d.display}`}</title>
              {/* área de interacción mayor que la barra */}
              <rect x={pad.left + i * bw} y={pad.top} width={bw} height={H - pad.top - pad.bottom} fill="transparent" />
              <path
                d={roundedTopBar(x, y, bw - gap, Math.max(h, d.value ? 1 : 0), 4)}
                fill="#12345A"
              />
              {(i % Math.ceil(data.length / 12) === 0 || data.length <= 12) && (
                <text x={x + (bw - gap) / 2} y={H - pad.bottom + 20} textAnchor="middle" fontSize="13" fill="#4A5A70">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <DataTable caption={`${title} (tabla)`} columns={["Periodo", valueLabel]} rows={data.map((d) => [d.label, d.display])} />
    </figure>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 min-w-0 max-w-full">
      <summary className="inline-flex min-h-12 items-center font-bold text-navy underline">Ver los datos en una tabla</summary>
      <div className="mt-2 relative max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={`${caption} (desplazable)`}>
        <table className="w-full text-left text-[0.9375rem]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-line">
              {columns.map((c) => (
                <th key={c} scope="col" className="py-2 pr-4 font-bold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line">
                {r.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="py-2 pr-4 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className="tabular py-2 pr-4">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
