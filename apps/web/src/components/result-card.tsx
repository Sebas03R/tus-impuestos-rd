import Link from "next/link";
import { ArrowRight, Building2, FileText, HardHat, Receipt, Store } from "lucide-react";
import { Code, Money, Pill } from "@/components/ui";
import { formatDate, sentenceCase, truncate } from "@/lib/format";
import { ENTITY_TYPE_LABEL } from "@/lib/labels";
import type { SearchHit } from "@/lib/queries/search";

const ICON = { proceso: FileText, contrato: Receipt, institucion: Building2, proveedor: Store, obra: HardHat } as const;

export function ResultCard({ hit }: { hit: SearchHit }) {
  const Icon = ICON[hit.entity_type as keyof typeof ICON] ?? FileText;
  const showMoney = ["proceso", "contrato", "obra"].includes(hit.entity_type);
  return (
    <article className="card grid gap-3 p-5 md:grid-cols-[1fr_auto] md:gap-6">
      <div className="min-w-0">
        <p className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-bold text-ink-muted">
          <Icon aria-hidden="true" className="size-4" />
          {ENTITY_TYPE_LABEL[hit.entity_type] ?? hit.entity_type}
          {hit.has_alert && <Pill tone="amber">Con alerta</Pill>}
        </p>
        <h3 className="text-lg font-bold leading-snug">
          <Link href={hit.href} className="text-navy-deep underline-offset-4 hover:underline">
            {truncate(sentenceCase(hit.title), 160)}
          </Link>
        </h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
          {hit.institution_name && hit.entity_type !== "institucion" && (
            <div className="flex gap-1.5">
              <dt className="sr-only">Institución</dt>
              <dd>{hit.institution_name}</dd>
            </div>
          )}
          {hit.supplier_name && hit.entity_type === "contrato" && (
            <div className="flex gap-1.5">
              <dt className="font-bold">Proveedor:</dt>
              <dd>{hit.supplier_name}</dd>
            </div>
          )}
          {hit.event_date && (
            <div className="flex gap-1.5">
              <dt className="font-bold">Fecha:</dt>
              <dd>{formatDate(hit.event_date)}</dd>
            </div>
          )}
          {hit.status && (
            <div className="flex gap-1.5">
              <dt className="font-bold">Estado:</dt>
              <dd>{hit.status}</dd>
            </div>
          )}
          {hit.modality && (
            <div className="flex gap-1.5">
              <dt className="font-bold">Modalidad:</dt>
              <dd>{hit.modality}</dd>
            </div>
          )}
          {hit.ref_code && (
            <div className="flex gap-1.5">
              <dt className="font-bold">Código:</dt>
              <dd>
                <Code>{hit.ref_code}</Code>
              </dd>
            </div>
          )}
          {hit.province && (
            <div className="flex gap-1.5">
              <dt className="font-bold">Provincia:</dt>
              <dd>{hit.province}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="flex flex-col items-start gap-3 md:items-end md:text-right">
        {showMoney && <Money value={hit.amount} currency={hit.currency} type={hit.amount_type ?? "estimado"} size="sm" />}
        <Link href={hit.href} className="btn btn-secondary mt-auto">
          Ver detalles <ArrowRight aria-hidden="true" className="size-5" />
          <span className="sr-only">: {truncate(hit.title, 80)}</span>
        </Link>
      </div>
    </article>
  );
}
