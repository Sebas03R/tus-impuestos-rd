import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui";
import { requireRole, ROLE_RANK } from "@/lib/auth/session";
import { getSql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { CorrectionUpdateForm } from "../forms";
import { AdminNav } from "../nav";

export const metadata = { title: "Solicitudes de corrección" };

export default function AdminCorrections() {
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
  const user = await requireRole("lector");
  const rows = await getSql()<{ id: string; created_at: Date; entity_type: string; entity_ref: string; requester_name: string | null; requester_email: string | null; message: string; evidence_url: string | null; status: string; resolution: string | null }[]>`
    select id::text, created_at, entity_type, entity_ref, requester_name, requester_email, message, evidence_url, status, resolution
    from correction_requests order by (status in ('recibida','en_revision')) desc, created_at desc limit 100`;
  return (
    <div>
      <AdminNav user={user} />
      <h1 className="text-2xl font-extrabold">Solicitudes de corrección</h1>
      <ul className="mt-6 space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="card p-4">
            <p className="text-sm text-ink-muted">#{r.id} · {formatDateTime(r.created_at)} · {r.entity_type} · <strong>{r.status}</strong></p>
            <p className="font-bold">{r.entity_ref}</p>
            <p className="mt-1 whitespace-pre-line">{r.message}</p>
            {r.evidence_url && <p className="text-sm">Respaldo: <span className="break-all">{r.evidence_url}</span> (verificar antes de abrir)</p>}
            {(r.requester_name || r.requester_email) && <p className="text-sm text-ink-muted">Contacto: {[r.requester_name, r.requester_email].filter(Boolean).join(" · ")}</p>}
            {r.resolution && <p className="text-sm">Resolución: {r.resolution}</p>}
            {ROLE_RANK[user.role] >= ROLE_RANK.editor && <CorrectionUpdateForm id={r.id} status={r.status} />}
          </li>
        ))}
        {rows.length === 0 && <li>No hay solicitudes.</li>}
      </ul>
    </div>
  );
}
