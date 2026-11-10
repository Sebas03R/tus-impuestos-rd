"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NavLinks } from "@/components/nav-links";

/** Menú móvil accesible: botón con aria-expanded, cierra con Escape y al navegar. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [lastPath, setLastPath] = useState(pathname);

  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-quiet px-3 min-[400px]:px-5"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
        <span className="max-[399px]:sr-only">{open ? "Cerrar" : "Menú"}</span>
      </button>
      <nav
        id={panelId}
        aria-label="Principal"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b-[3px] border-ink bg-white px-4 pb-6 pt-3"
      >
        <NavLinks variant="mobile" onNavigate={() => setOpen(false)} />
      </nav>
    </div>
  );
}
