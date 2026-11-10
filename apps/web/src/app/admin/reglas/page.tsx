import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getMethodology } from "@/lib/queries/fiscal";
import { RuleForm } from "../forms";
import { AdminNav } from "../nav";

export const metadata = { title: "Reglas y umbrales" };

export default function AdminRules() {
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
  const m = await getMethodology();
  return (
    <div>
      <AdminNav user={user} />
      <h1 className="text-2xl font-extrabold">Reglas activas y umbrales</h1>
      <p className="mt-1 text-ink-muted">Cambiar un parámetro crea una versión nueva; las anteriores se conservan para reproducir análisis pasados. Solo el rol administrador puede crear versiones.</p>
      <ul className="mt-6 space-y-4">
        {m.rules.map((r) => (
          <li key={r.code} className="card p-4">
            <p className="font-bold">{r.name} <span className="font-normal text-ink-muted">({r.code}, versión {r.version}, {formatDateTime(r.created_at)})</span></p>
            {r.change_note && <p className="text-sm text-ink-muted">Último cambio: {r.change_note}</p>}
            {user.role === "admin" ? <RuleForm code={r.code} params={JSON.stringify(r.params, null, 2)} /> : <pre className="mt-2 relative overflow-x-auto text-sm">{JSON.stringify(r.params, null, 2)}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}
