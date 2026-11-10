import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Big_Shoulders, Big_Shoulders_Stencil } from "next/font/google";
import { Suspense } from "react";
import { DemoBanner } from "@/components/data-status";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/lib/site";
import "./globals.css";

/* Atkinson Hyperlegible fue diseñada para lectores con baja visión: encaja con un público amplio. */
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
  display: "swap",
});
const atkinsonMono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  variable: "--font-atkinson-mono",
  display: "swap",
});
/* Big Shoulders: condensada de cartel cívico para titulares y cifras grandes. La versión stencil
 * (pintada de protesta) se usa solo en el titular de la portada. */
const shoulders = Big_Shoulders({
  subsets: ["latin", "latin-ext"],
  variable: "--font-shoulders",
  display: "swap",
  axes: ["opsz"],
});
const stencil = Big_Shoulders_Stencil({
  subsets: ["latin", "latin-ext"],
  variable: "--font-stencil-face",
  display: "swap",
  weight: "900",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Tus Impuestos RD — ¿Por qué pagaron tanto?",
    template: "%s · Tus Impuestos RD",
  },
  description:
    "Las compras del Estado dominicano que salieron mucho más caras que lo que pagaron otras instituciones por lo mismo. Datos oficiales, cálculos abiertos. Iniciativa ciudadana independiente.",
  applicationName: "Tus Impuestos RD",
  openGraph: {
    type: "website",
    locale: "es_DO",
    siteName: "Tus Impuestos RD",
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-DO" className={`${atkinson.variable} ${atkinsonMono.variable} ${shoulders.variable} ${stencil.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#contenido"
          className="sr-only z-50 bg-ink px-4 py-3 font-bold text-yellow focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Saltar al contenido
        </a>
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
        <SiteHeader />
        <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
