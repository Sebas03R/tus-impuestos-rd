import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { getSql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { AdminNav } from "../nav";

export const metadata = { title: "Auditoría" };

export default function AdminAudit() {
  return (
    <div className="container-page py-8">
      <Suspense fallback={<Skeleton lines={6} />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  const user = await requireRole("admin");
  const rows = await getSql()<{ id: string; at: Date; actor: string; action: string; entity: string | null; entity_id: string | null; details: unknown }[]>`
    select id::text, at, actor, action, entity, entity_id, details from audit_logs order by id desc limit 200`;
  return (
    <div>
      <AdminNav user={user} />
      <h1 className="text-2xl font-extrabold">Auditoría de cambios</h1>
      <div className="mt-4 relative overflow-x-auto" tabIndex={0} role="region" aria-label="Auditoría (desplazable)">
        <table className="w-full bg-white text-left text-sm">
          <thead><tr className="border-b-2 border-line"><th className="p-2">Fecha</th><th className="p-2">Actor</th><th className="p-2">Acción</th><th className="p-2">Registro</th><th className="p-2">Detalle</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top">
                <td className="p-2 whitespace-nowrap">{formatDateTime(r.at)}</td><td className="p-2">{r.actor}</td><td className="p-2">{r.action}</td>
                <td className="p-2">{[r.entity, r.entity_id].filter(Boolean).join(" ")}</td>
                <td className="p-2"><pre className="max-w-md whitespace-pre-wrap text-xs">{JSON.stringify(r.details)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
