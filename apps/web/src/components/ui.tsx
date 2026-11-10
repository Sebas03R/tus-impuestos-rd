import Link from "next/link";
import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  ExternalLink,
  Info,
  OctagonAlert,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import { AMOUNT_TYPE_LABEL, formatMoney, SIN_DATO } from "@/lib/format";
import { PUBLIC_LABEL } from "@/lib/labels";

type Tone = "red" | "amber" | "navy" | "green" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  red: "bg-red-soft text-red-text border-red/40",
  amber: "bg-amber-soft text-amber-text border-amber/40",
  navy: "bg-sky text-navy border-navy/25",
  green: "bg-green-soft text-green border-green/35",
  muted: "bg-mist text-ink-muted border-line",
};

const TONE_ICON: Record<Tone, typeof Info> = {
  red: OctagonAlert,
  amber: TriangleAlert,
  navy: CircleDashed,
  green: CircleCheck,
  muted: CircleMinus,
};

/** Insignia con texto + ícono (nunca solo color). */
export function Pill({ tone = "muted", children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 border-2 px-2 py-0.5 text-[0.8125rem] font-bold leading-6 ${TONE_CLASS[tone]}`}
    >
      {icon && <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />}
      {children}
    </span>
  );
}

export function AlertLabel({ label }: { label: string }) {
  const info = PUBLIC_LABEL[label] ?? { text: label, tone: "muted" as const };
  return <Pill tone={info.tone}>{info.text}</Pill>;
}

/**
 * Monto con su tipo y moneda siempre visibles. El tipo se muestra como etiqueta
 * en mayúsculas pequeñas encima de la cifra (la "etiqueta de etapa").
 */
export function Money({
  value,
  currency,
  type,
  size = "md",
  compact = false,
}: {
  value: string | number | null | undefined;
  currency: string | null | undefined;
  type: string;
  size?: "sm" | "md" | "lg";
  compact?: boolean;
}) {
  const unknown = value === null || value === undefined || value === "";
  const sizes = { sm: "text-lg", md: "text-2xl", lg: "text-3xl min-[380px]:text-4xl md:text-5xl" };
  return (
    <span className="inline-flex flex-col">
      <span className="eyebrow">{AMOUNT_TYPE_LABEL[type] ?? type}</span>
      {unknown ? (
        <span className={`font-bold text-ink-muted ${size === "sm" ? "text-base" : "text-lg"}`}>{SIN_DATO}</span>
      ) : (
        <span className={`fig mt-1 self-start whitespace-normal text-ink [overflow-wrap:anywhere] ${sizes[size]}`}>{formatMoney(value, currency, { compact })}</span>
      )}
      {!unknown && currency && currency !== "DOP" && (
        <span className="text-sm text-ink-muted">En {currency}; no se convierte a pesos.</span>
      )}
    </span>
  );
}

/** Cifra destacada dentro de un texto: tipografía de cartel con resaltador (o subrayado rojo). */
export function Fig({ children, tone = "mark", className = "" }: { children: ReactNode; tone?: "mark" | "red"; className?: string }) {
  return <strong className={`fig ${tone === "red" ? "fig-red" : ""} ${className}`}>{children}</strong>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-bold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

export function SectionHeading({
  title,
  intro,
  id,
  level = 2,
}: {
  title: string;
  intro?: ReactNode;
  id?: string;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 max-w-3xl">
      <H id={id} className={level === 2 ? "text-[2rem] uppercase leading-none md:text-[2.5rem]" : "text-xl font-bold"}>
        {title}
      </H>
      {intro && <p className="mt-1.5 text-ink-muted">{intro}</p>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b-[3px] border-ink bg-white">
      <div className="container-page py-8 md:py-12">
        {eyebrow && <p className="kicker kicker-ink mb-3">{eyebrow}</p>}
        <h1 className="max-w-5xl text-[2.5rem] uppercase md:text-[4rem]">{title}</h1>
        {intro && <div className="mt-4 max-w-3xl text-lg">{intro}</div>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-start gap-3 p-6" role="status">
      <SearchX aria-hidden="true" className="size-7 text-navy" />
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <div className="max-w-2xl text-ink-muted">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "No pudimos cargar esta información", children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-red/40 bg-red-soft p-5" role="alert">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-red-text" />
      <div>
        <p className="font-bold text-red-text">{title}</p>
        <div className="mt-1 text-ink">
          {children ?? "La base de datos no respondió. Vuelve a intentarlo en unos minutos; no mostramos cifras incompletas."}
        </div>
      </div>
    </div>
  );
}

export function Notice({ tone = "navy", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const Icon = tone === "amber" ? TriangleAlert : tone === "red" ? OctagonAlert : Info;
  return (
    <div className={`flex items-start gap-3 rounded-[var(--radius-card)] border p-4 ${TONE_CLASS[tone]}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="text-ink">
        {title && <p className="font-bold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function ExternalA({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`relative inline-flex items-center gap-1 font-bold text-navy underline ${className}`}
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">(abre en otra pestaña)</span>
    </a>
  );
}

export function Pagination({
  page,
  pages,
  hrefFor,
  label = "Paginación de resultados",
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  label?: string;
}) {
  if (pages <= 1) return null;
  const nums = new Set<number>([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...nums].sort((a, b) => a - b);
  return (
    <nav aria-label={label} className="mt-8 flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <Link className="btn btn-quiet" href={hrefFor(page - 1)} rel="prev">
          <ChevronLeft aria-hidden="true" className="size-5" /> Anterior
        </Link>
      ) : null}
      <ol className="flex flex-wrap items-center gap-1">
        {sorted.map((n, i) => (
          <li key={n} className="flex items-center gap-1">
            {i > 0 && sorted[i - 1] !== n - 1 && <span aria-hidden="true" className="px-1 text-ink-muted">…</span>}
            {n === page ? (
              <span
                aria-current="page"
                className="inline-flex size-12 items-center justify-center bg-navy font-bold text-white"
              >
                <span className="sr-only">Página </span>
                {n}
              </span>
            ) : (
              <Link
                href={hrefFor(n)}
                className="inline-flex size-12 items-center justify-center border-2 border-ink font-bold text-navy hover:bg-sky"
              >
                <span className="sr-only">Página </span>
                {n}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {page < pages ? (
        <Link className="btn btn-quiet" href={hrefFor(page + 1)} rel="next">
          Siguiente <ChevronRight aria-hidden="true" className="size-5" />
        </Link>
      ) : null}
    </nav>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Ruta de navegación" className="mb-4 text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-ink-muted">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden="true" className="size-4" />}
            {it.href ? (
              <Link href={it.href} className="font-bold text-navy underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Skeleton({ lines = 3, label = "Cargando información…" }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="card space-y-3 p-6">
      <span className="sr-only">{label}</span>
      <p aria-hidden="true" className="text-sm font-bold text-ink-muted">
        {label}
      </p>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} aria-hidden="true" className="h-4 rounded bg-mist" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.95em] break-all">{children}</span>;
}
