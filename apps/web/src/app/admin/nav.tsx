import Link from "next/link";
import { logout } from "./actions";
import type { SessionUser } from "@/lib/auth/session";

export function AdminNav({ user }: { user: SessionUser }) {
  const links = [
    { href: "/admin", label: "Estado" },
    { href: "/admin/alertas", label: "Alertas" },
    { href: "/admin/reglas", label: "Reglas" },
    { href: "/admin/correcciones", label: "Correcciones" },
    ...(user.role === "admin" ? [{ href: "/admin/auditoria", label: "Auditoría" }] : []),
  ];
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <nav aria-label="Administración">
        <ul className="flex flex-wrap gap-2">
          {links.map((l) => (
            <li key={l.href}><Link className="btn btn-quiet" href={l.href}>{l.label}</Link></li>
          ))}
        </ul>
      </nav>
      <form action={logout} className="flex items-center gap-3">
        <span className="text-sm text-ink-muted">{user.name} · {user.role}</span>
        <button className="btn btn-quiet">Salir</button>
      </form>
    </div>
  );
}
