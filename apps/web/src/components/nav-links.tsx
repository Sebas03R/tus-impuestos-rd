"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/components/nav";

const DESKTOP_LINK =
  "inline-flex min-h-12 items-center px-3 font-bold text-ink no-underline hover:bg-yellow-soft aria-[current=page]:bg-yellow aria-[current=page]:shadow-[inset_0_-3px_0_var(--color-ink)]";

export function NavLinksStatic() {
  return (
    <ul className="flex items-center gap-1">
      {NAV.map((item) => (
        <li key={item.href}>
          <Link href={item.href} className={DESKTOP_LINK}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function NavLinks({ variant, onNavigate }: { variant: "desktop" | "mobile"; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname?.startsWith(href));
  if (variant === "desktop") {
    return (
      <ul className="flex items-center gap-1">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={DESKTOP_LINK}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive(item.href) ? "page" : undefined}
            className="flex min-h-14 items-center px-4 font-display text-2xl font-black uppercase text-ink no-underline hover:bg-yellow-soft aria-[current=page]:bg-yellow aria-[current=page]:shadow-[inset_5px_0_0_var(--color-red)]"
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
