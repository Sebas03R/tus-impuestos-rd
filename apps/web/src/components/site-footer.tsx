import Link from "next/link";
import { Suspense } from "react";
import { DataFreshness } from "@/components/data-status";
import { LogoMark } from "@/components/logo";
import { INDEPENDENCE_NOTICE } from "@/lib/labels";

const LINKS = [
  { href: "/acerca", label: "Acerca del proyecto" },
  { href: "/metodologia", label: "Metodología" },
  { href: "/fuentes", label: "Fuentes oficiales" },
  { href: "/privacidad", label: "Política de privacidad" },
  { href: "/accesibilidad", label: "Accesibilidad" },
  { href: "/correcciones", label: "Contacto y correcciones" },
  { href: "/api/docs", label: "API de datos" },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-[6px] border-red bg-ink text-white no-print">
      <div className="container-page grid gap-8 py-10 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-2xl font-black uppercase">Tus Impuestos RD</span>
          </div>
          <p className="mt-4 max-w-md font-display text-[2rem] font-black uppercase leading-[0.95] text-yellow">
            El dinero es público. La información también.
          </p>
          <p className="mt-5 max-w-md border-2 border-white/40 p-3 font-bold">{INDEPENDENCE_NOTICE}</p>
        </div>
        <nav aria-label="Enlaces del pie de página">
          <ul className="grid gap-1 sm:grid-cols-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-12 items-center text-white underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/15">
        <div className="container-page flex flex-col gap-2 py-5 text-[#d9d9d9] md:flex-row md:items-center md:justify-between">
          <Suspense fallback={<p className="text-sm">Consultando fecha de actualización…</p>}>
            <DataFreshness variant="footer" />
          </Suspense>
          <p className="text-sm">Datos de fuentes oficiales dominicanas; cada ficha enlaza al registro original.</p>
        </div>
      </div>
    </footer>
  );
}
