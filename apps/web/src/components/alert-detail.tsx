import Link from "next/link";
import type { ReactNode } from "react";
import { FileText, History, Scale } from "lucide-react";
import { AlertLabel, Code, ExternalA, Field, Fig, Notice, Pill, SectionHeading } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, SIN_DATO, textOr, toNumber } from "@/lib/format";
import { formatTimes, PriceGauge, PriceTags, timesFromPct, timesPhrase } from "@/components/meters";
import {
  ALERT_DISCLAIMER,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  EVIDENCE_GRADE,
  METRIC_LABEL,
  MONEY_METRICS,
  PCT_METRICS,
  PUBLIC_LABEL,
  RATIO_METRICS,
} from "@/lib/labels";
import type { AlertDetail, EvidenceRow, StatusHistoryRow } from "@/lib/queries/alerts";

export function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  if (typeof value === "string" && value) return [value];
  return [];
}

function metricValue(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === "") return SIN_DATO;
  if (MONEY_METRICS.has(key)) return formatMoney(value, currency, { decimals: 2 });
  if (PCT_METRICS.has(key)) return formatPercent(value);
  if (RATIO_METRICS.has(key)) {
    const n = toNumber(value);
    return n === null ? String(value) : `${formatNumber(n * 100, 1)} %`;
  }
  if (key.endsWith("_from") || key.endsWith("_to") || key.endsWith("_date")) return formatDate(value);
  if (typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))) return formatNumber(value, 2);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DisclaimerBanner() {
  return (
    <div className="rounded-[var(--radius-card)] border-2 border-amber/50 bg-amber-soft p-4 font-bold text-ink" role="note">
      {ALERT_DISCLAIMER}
    </div>
  );
}

export function StatusNotice({ alert, history }: { alert: AlertDetail; history: StatusHistoryRow[] }) {
  if (alert.status === "publicada") return null;
  const last = [...history].reverse().find((h) => h.to_status === alert.status);
  return (
    <Notice tone={alert.status === "aclarada" ? "green" : "navy"} title={`Esta alerta fue ${alert.status === "aclarada" ? "aclarada" : "retirada"}`}>
      {last ? `${last.reason} (${formatDate(last.changed_at)}).` : "Ya no cumple los criterios de publicación con los datos actuales."} La conservamos
      para mantener el historial público de correcciones.
    </Notice>
  );
}

export function PriceFigures({ alert }: { alert: AlertDetail }) {
  const m = alert.metrics as Record<string, unknown>;
  const cur = (m.currency as string) || "DOP";
  const cells: { label: string; value: ReactNode; strong?: boolean }[] = [
    { label: "Precio contratado por unidad", value: formatMoney(m.contracted_price, cur, { decimals: 2 }), strong: true },
    { label: "Precio de referencia por unidad", value: formatMoney(m.reference_price, cur, { decimals: 2 }), strong: true },
    { label: "Diferencia por unidad", value: formatMoney(m.diff_unit, cur, { decimals: 2 }) },
    { label: "Diferencia porcentual", value: formatPercent(m.diff_pct) },
    { label: "Cantidad", value: `${formatNumber(m.quantity, 2)} ${textOr(m.unit, "")}` },
    { label: "Diferencia total estimada", value: formatMoney(m.diff_total, cur, { decimals: 2 }), strong: true },
    { label: "Comparaciones válidas", value: `${formatNumber(m.n_peers)} compras de ${formatNumber(m.n_institutions)} instituciones` },
    {
      label: "Período de referencia",
      value: m.window_from || m.window_to ? `${formatDate(m.window_from)} – ${formatDate(m.window_to)}` : SIN_DATO,
    },
  ];
  const times = timesFromPct(m.diff_pct);
  return (
    <div>
      {typeof m.item_description === "string" && (
        <p className="mb-3 text-lg">
          Artículo comparado: <strong>{m.item_description}</strong>
        </p>
      )}
      {times !== null && (
        <div className="card-raise mb-6 grid gap-6 p-5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] md:items-center md:p-6">
          <div className="flex flex-col items-center">
            <PriceGauge diffPct={m.diff_pct} size="md" />
            <p className="text-center">
              <span className="font-display text-[4.5rem] font-black leading-none text-red-text">×{formatTimes(times)}</span>
              <span className="block font-bold">Pagó {timesPhrase(times)}</span>
            </p>
          </div>
          <PriceTags
            paid={m.contracted_price}
            reference={m.reference_price}
            currency={cur}
            unit={typeof m.unit === "string" ? m.unit : null}
            payer={alert.institution_name ? (alert.institution_name.length > 40 ? "esta institución" : alert.institution_name) : "esta institución"}
            peers={toNumber(m.n_peers)}
            institutions={toNumber(m.n_institutions)}
          />
        </div>
      )}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="card p-4">
            <dt className="text-sm font-bold text-ink-muted">{c.label}</dt>
            <dd className={`tabular mt-1 ${c.strong ? "font-display text-[1.75rem] font-black leading-none text-ink" : "text-xl font-bold"}`}>{c.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-muted">
        Precios unitarios antes de impuestos y después de descuentos, en pesos dominicanos.
        {typeof m.tax_assumption === "string" && ` ${m.tax_assumption}`} La diferencia calculada no es, por sí sola, un perjuicio
        económico.
      </p>
    </div>
  );
}

export function GenericMetrics({ alert }: { alert: AlertDetail }) {
  const m = alert.metrics as Record<string, unknown>;
  const entries = Object.entries(m).filter(([k]) => k !== "currency");
  if (!entries.length) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k} className="card p-4">
          <dt className="text-sm font-bold text-ink-muted">{METRIC_LABEL[k] ?? k.replace(/_/g, " ")}</dt>
          <dd className="tabular mt-1 text-xl font-bold">{metricValue(k, v, (m.currency as string) || alert.currency)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PriorityExplanation({ alert }: { alert: AlertDetail }) {
  const b = alert.priority_breakdown ?? {};
  const parts: [string, string][] = [
    ["precio", "Desviación de precio comparable"],
    ["magnitud", "Magnitud económica"],
    ["competencia", "Competencia y contratación"],
    ["documentacion", "Documentación"],
  ];
  const grade = EVIDENCE_GRADE[alert.evidence_grade];
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
      <div className="card p-5">
        <p className="font-bold">Prioridad de revisión: {formatNumber(alert.priority_score, 0)} de 100</p>
        <p className="text-sm text-ink-muted">No es una probabilidad de irregularidad. Sirve para ordenar qué revisar primero.</p>
        <ul className="mt-3 space-y-2">
          {parts.map(([k, label]) => {
            const v = toNumber(b[k]);
            return (
              <li key={k}>
                <div className="flex justify-between text-[0.9375rem]">
                  <span>{label}</span>
                  <span className="tabular font-bold">{v === null ? SIN_DATO : `${formatNumber(v, 0)}/100`}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-mist" aria-hidden="true">
                  <div className="h-2 rounded-full bg-navy" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        {typeof b.explicacion === "string" && <p className="mt-3 text-[0.9375rem]">{b.explicacion}</p>}
      </div>
      <div className="card p-5">
        <p className="flex items-center gap-2 font-bold">
          <Scale aria-hidden="true" className="size-5 text-navy" /> Confianza de la evidencia
        </p>
        <p className="mt-2">
          <Pill tone={alert.evidence_grade === "A" ? "green" : alert.evidence_grade === "B" ? "navy" : "muted"}>{grade?.text ?? alert.evidence_grade}</Pill>
        </p>
        <p className="mt-2 text-[0.9375rem]">{grade?.help}</p>
        <p className="mt-2 text-sm text-ink-muted">La confianza se evalúa por separado de la prioridad.</p>
      </div>
    </div>
  );
}

export function Proofs({ evidence }: { evidence: EvidenceRow[] }) {
  const docs = evidence.filter((e) => e.kind === "registro" || e.kind === "documento");
  if (!docs.length) return <p className="text-ink-muted">Esta alerta no tiene registros enlazados.</p>;
  return (
    <ul className="space-y-2">
      {docs.map((e) => (
        <li key={e.id} className="flex items-start gap-3 border-2 border-ink p-3">
          <FileText aria-hidden="true" className="mt-1 size-5 shrink-0 text-navy" />
          <div className="min-w-0">
            {e.source_url ? <ExternalA href={e.source_url}>{e.label}</ExternalA> : <span className="font-bold">{e.label}</span>}
            <p className="text-sm text-ink-muted">{e.kind === "documento" ? "Documento oficial" : "Registro oficial"}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ComparisonDetails({ evidence, open = false }: { evidence: EvidenceRow[]; open?: boolean }) {
  const refs = evidence.filter((e) => e.kind === "referencia");
  const calcs = evidence.filter((e) => e.kind === "calculo");
  if (!refs.length && !calcs.length) return null;
  return (
    <details className="card p-5" open={open || undefined}>
      <summary className="flex min-h-12 items-center text-lg font-bold text-navy">¿Cómo hicimos esta comparación?</summary>
      {calcs.length > 0 && (
        <div className="mt-3 space-y-3">
          <h3 className="font-bold">Cálculos</h3>
          {calcs.map((c) => {
            const d = (c.data ?? {}) as { formula?: string; values?: Record<string, unknown> };
            return (
              <div key={c.id} className="bg-mist p-3">
                <p className="font-bold">{c.label}</p>
                {d.formula && <p className="mt-1 font-mono text-[0.9375rem] [overflow-wrap:anywhere]">{d.formula}</p>}
                {d.values && (
                  <ul className="mt-1 text-[0.9375rem]">
                    {Object.entries(d.values).map(([k, v]) => (
                      <li key={k}>
                        <span className="font-mono [overflow-wrap:anywhere]">{k}</span> = <span className="tabular [overflow-wrap:anywhere]">{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {refs.length > 0 && (
        <div className="mt-5">
          <h3 className="font-bold">Compras usadas como referencia ({refs.length})</h3>
          <p className="text-sm text-ink-muted">Precios unitarios antes de impuestos, en pesos dominicanos.</p>
          <ul className="mt-3 space-y-2">
            {refs.map((r) => {
              const d = (r.data ?? {}) as Record<string, unknown>;
              const contract = typeof d.contract_code === "string" ? d.contract_code : null;
              return (
                <li key={r.id} className="border-2 border-ink p-3 text-[0.9375rem]">
                  <p className="font-bold">{typeof d.description === "string" ? d.description : r.label}</p>
                  <p>
                    {textOr(d.institution)} · {formatDate(d.date)} · Cantidad {formatNumber(d.quantity, 2)} · Precio unitario{" "}
                    <Fig>{formatMoney(d.unit_price, "DOP", { decimals: 2 })}</Fig>
                    {d.similarity !== undefined && ` · Similitud ${formatNumber(d.similarity, 0)} %`}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-3">
                    {contract && (
                      <Link className="font-bold text-navy underline" href={`/contratos/${encodeURIComponent(contract)}`}>
                        Contrato <Code>{contract}</Code>
                      </Link>
                    )}
                    {(typeof d.url === "string" && d.url) || r.source_url ? (
                      <ExternalA href={(typeof d.url === "string" && d.url) || r.source_url!}>Fuente oficial</ExternalA>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </details>
  );
}

export function HistoryTimeline({ history }: { history: StatusHistoryRow[] }) {
  if (!history.length) return null;
  return (
    <details className="border-2 border-ink p-4">
      <summary className="flex min-h-12 items-center gap-2 font-bold text-navy">
        <History aria-hidden="true" className="size-5" /> Historial de esta alerta ({history.length})
      </summary>
      <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
        {history.map((h, i) => (
          <li key={i}>
            <p className="font-bold">
              {formatDateTime(h.changed_at)} — {PUBLIC_LABEL[h.to_label]?.text ?? h.to_label} ({ALERT_STATUS_LABEL[h.to_status] ?? h.to_status})
            </p>
            <p className="text-[0.9375rem]">{h.reason}</p>
            <p className="text-sm text-ink-muted">Por: {h.actor === "sistema" ? "análisis automático" : "equipo editorial"}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function AlertHeader({ alert }: { alert: AlertDetail }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <AlertLabel label={alert.public_label} />
        <span className="font-bold text-ink-muted">{ALERT_TYPE_LABEL[alert.alert_type] ?? alert.alert_type}</span>
        <span className="text-sm text-ink-muted">· Alerta <Code>{alert.public_id}</Code></span>
      </div>
      <h1 className="mt-3 max-w-4xl text-[2.25rem] md:text-[3.25rem]">{alert.title}</h1>
    </>
  );
}

export function AlertFacts({ alert }: { alert: AlertDetail }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Institución">
        {alert.institution_slug ? (
          <Link className="font-bold text-navy underline" href={`/instituciones/${alert.institution_slug}`}>{alert.institution_name}</Link>
        ) : (
          textOr(alert.institution_name)
        )}
      </Field>
      <Field label="Proceso">
        {alert.process_code ? (
          <Link className="font-bold text-navy underline" href={`/compras/${encodeURIComponent(alert.process_code)}`}>
            <Code>{alert.process_code}</Code>
          </Link>
        ) : (
          SIN_DATO
        )}
      </Field>
      <Field label="Proveedor">
        {alert.supplier_id ? <Link className="font-bold text-navy underline" href={`/proveedores/${alert.supplier_id}`}>{alert.supplier_name}</Link> : textOr(alert.supplier_name)}
      </Field>
      <Field label="Fecha del hecho">{formatDate(alert.event_date)}</Field>
      <Field label="Fecha del análisis">{formatDateTime(alert.last_evaluated_at)}</Field>
      <Field label="Detectada por primera vez">{formatDate(alert.first_detected_at)}</Field>
      <Field label="Regla aplicada">
        {alert.rule_name ?? alert.rule_code} (versión {alert.rule_version}) · <Link className="text-navy underline" href={`/metodologia#regla-${alert.rule_code}`}>ver metodología</Link>
      </Field>
      <Field label="Versión del análisis">{alert.current_version}</Field>
    </dl>
  );
}

export function ListSection({ id, title, items, empty }: { id: string; title: string; items: string[]; empty: string }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <SectionHeading id={id} title={title} />
      {items.length ? (
        <ul className="list-disc space-y-2 pl-6">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{empty}</p>
      )}
    </section>
  );
}
