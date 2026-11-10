import { MARK_PATH } from "@/lib/brand";

/**
 * Marca propia «La etiqueta que pregunta»: etiqueta de precio con el «¿» calado sobre amarillo de
 * góndola. No usa símbolos patrios ni oficiales. Fuente: docs/marca/logo.
 */
export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="244" height="244" fill="#FFD400" stroke="#111111" strokeWidth="12" />
      <path fill="#111111" fillRule="evenodd" transform="translate(28.16 28.16) scale(0.78)" d={MARK_PATH} />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 min-[360px]:gap-2.5">
      <LogoMark className="size-9 shrink-0 min-[360px]:size-10" />
      <span className="leading-none">
        <span className="block font-display text-[1.2rem] font-black min-[360px]:text-[1.375rem] uppercase leading-[0.9] tracking-[0.01em] text-ink sm:text-[1.5rem]">
          Tus Impuestos RD
        </span>
        <span className="mt-1 hidden text-[0.75rem] font-bold text-ink-muted min-[400px]:block">Observatorio ciudadano independiente</span>
      </span>
    </span>
  );
}
