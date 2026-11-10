import { Check, Minus } from "lucide-react";
import { formatDate } from "@/lib/format";

export type Stage = {
  key: string;
  label: string;
  help?: string;
  /** done = ocurrió con evidencia; pending = aún no; unknown = sin dato. */
  state: "done" | "pending" | "unknown";
  date?: Date | string | null;
  note?: string;
};

/**
 * La "ruta del peso": las etapas de una compra en orden real. La numeración es
 * información (secuencia legal), no decoración.
 */
export function StageRail({ stages, title }: { stages: Stage[]; title?: string }) {
  return (
    <ol className="grid gap-0 md:grid-cols-5" aria-label={title}>
      {stages.map((s, i) => {
        const done = s.state === "done";
        return (
          <li key={s.key} className="relative flex gap-3 pb-5 md:flex-col md:gap-2 md:pb-0 md:pr-3">
            {/* conector */}
            {i < stages.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[1.1875rem] top-10 h-[calc(100%-2.5rem)] w-0.5 md:left-10 md:top-[1.1875rem] md:h-0.5 md:w-[calc(100%-2.5rem)] ${
                  done && stages[i + 1]?.state === "done" ? "bg-navy" : "bg-line"
                }`}
              />
            )}
            <span
              className={`relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-base font-extrabold ${
                done
                  ? "border-navy bg-navy text-white"
                  : s.state === "unknown"
                    ? "border-dashed border-ink-muted bg-white text-ink-muted"
                    : "border-line bg-white text-ink-muted"
              }`}
            >
              {done ? <Check aria-hidden="true" className="size-5" strokeWidth={3} /> : s.state === "unknown" ? <Minus aria-hidden="true" className="size-5" /> : i + 1}
            </span>
            <div className="min-w-0 pt-1.5 md:pt-0">
              <p className="font-bold text-navy-deep">
                <span className="sr-only">Etapa {i + 1}: </span>
                {s.label}
                <span className="sr-only">
                  {done ? " (ocurrió)" : s.state === "unknown" ? " (sin dato)" : " (pendiente)"}
                </span>
              </p>
              {s.date !== undefined && (
                <p className="text-sm text-ink-muted">{s.date ? formatDate(s.date) : done ? "Fecha sin dato" : "—"}</p>
              )}
              {s.note && <p className="text-sm text-ink-muted">{s.note}</p>}
              {s.help && !s.note && <p className="text-sm text-ink-muted">{s.help}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
