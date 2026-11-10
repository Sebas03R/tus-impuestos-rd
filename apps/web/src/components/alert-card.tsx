import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { formatTimes, timesFromPct, timesPhrase, TimesBar } from "@/components/meters";
import { AlertLabel, Fig, Money } from "@/components/ui";
import { formatDate, formatMoney, truncate } from "@/lib/format";
import { ALERT_TYPE_LABEL } from "@/lib/labels";
import type { AlertListRow } from "@/lib/queries/alerts";

/** Tarjeta de alerta: responde las 5 preguntas de forma breve. */
export function AlertCard({ alert, headingLevel = 3 }: { alert: AlertListRow; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const missing = Array.isArray(alert.missing_information) ? alert.missing_information : [];
  const times = timesFromPct(alert.diff_pct);
  return (
    <article className="card flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <AlertLabel label={alert.public_label} />
        <span className="text-sm font-bold text-ink-muted">{ALERT_TYPE_LABEL[alert.alert_type] ?? alert.alert_type}</span>
      </div>
      <H className="text-lg font-bold leading-snug">
        <Link href={`/radar/${alert.public_id}`} className="text-ink underline decoration-2 underline-offset-4 hover:bg-yellow-soft">
          {alert.title}
        </Link>
      </H>
      {alert.alert_type === "precio" && times !== null && (
        <div className="flex items-center gap-3">
          <span className="font-display text-[2.25rem] font-black leading-none tabular text-red-text">×{formatTimes(times)}</span>
          <div className="flex-1">
            <TimesBar diffPct={alert.diff_pct} />
            <span className="mt-1 block text-sm text-ink-muted">Pagó {timesPhrase(times)}</span>
          </div>
        </div>
      )}
      <dl className="grid gap-3 text-[0.9375rem]">
        <div>
          <dt className="font-bold text-navy-deep">¿Qué ocurrió?</dt>
          <dd className="text-ink">{truncate(alert.summary, 220)}</dd>
        </div>
        <div>
          <dt className="font-bold text-navy-deep">¿Por qué llamó la atención?</dt>
          <dd className="text-ink">{truncate(alert.why_flagged, 200)}</dd>
        </div>
        <div>
          <dt className="font-bold text-navy-deep">¿De cuánto dinero estamos hablando?</dt>
          <dd>
            {alert.alert_type === "precio" ? (
              <>
                <Fig tone="red" className="text-2xl">
                  {formatMoney(alert.amount_involved, alert.currency)}
                </Fig>
                <span className="block text-sm text-ink-muted">Diferencia total estimada frente al precio de referencia.</span>
              </>
            ) : (
              <Money value={alert.amount_involved} currency={alert.currency} type="contratado" size="sm" />
            )}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-navy-deep">¿Qué documentos respaldan el análisis?</dt>
          <dd className="flex items-center gap-1.5 text-ink">
            <FileText aria-hidden="true" className="size-4 text-ink-muted" />
            {alert.evidence_documents > 0
              ? alert.evidence_documents === 1
                ? "1 registro oficial enlazado"
                : `${alert.evidence_documents} registros y documentos oficiales enlazados`
              : "Registros oficiales enlazados en la ficha"}
          </dd>
        </div>
        {missing.length > 0 && (
          <div>
            <dt className="font-bold text-navy-deep">¿Qué información falta?</dt>
            <dd className="text-ink">{truncate(String(missing[0]), 160)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm text-ink-muted">
        <span>
          {alert.institution_name ?? "Institución sin dato"} · Analizada el {formatDate(alert.last_evaluated_at)}
        </span>
        <Link href={`/radar/${alert.public_id}`} className="inline-flex min-h-12 items-center gap-1 font-bold text-navy underline">
          Ver la alerta <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </article>
  );
}
