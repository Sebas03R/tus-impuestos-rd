import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/components/logo";
import { MobileMenu } from "@/components/mobile-menu";
import { NavLinks, NavLinksStatic } from "@/components/nav-links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-ink bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90 no-print">
      <div aria-hidden="true" className="h-1.5 bg-red" />
      <div className="container-page flex min-h-[4.25rem] items-center justify-between gap-3">
        <Link href="/" className="min-w-0 no-underline">
          <Wordmark />
        </Link>
        <nav aria-label="Principal" className="hidden lg:block">
          <Suspense fallback={<NavLinksStatic />}>
            <NavLinks variant="desktop" />
          </Suspense>
        </nav>
        <Suspense fallback={<MobileMenuFallback />}>
          <MobileMenu />
        </Suspense>
      </div>
    </header>
  );
}

function MobileMenuFallback() {
  return (
    <div className="lg:hidden">
      <Link href="/ayuda#mapa-del-sitio" className="btn btn-quiet">
        Menú
      </Link>
    </div>
  );
}
