import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AlertLabel, Skeleton } from "@/components/ui";
import { requireRole, ROLE_RANK } from "@/lib/auth/session";
import { getSql } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ALERT_TYPE_LABEL } from "@/lib/labels";
import { AlertStatusForm } from "../forms";
import { AdminNav } from "../nav";

export const metadata = { title: "Alertas" };

export default function AdminAlerts(props: PageProps<"/admin/alertas">) {
  return (
    <div className="container-page py-8">
      <Suspense fallback={<Skeleton lines={6} />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/admin/alertas">["searchParams"] }) {
  await connection();
  const user = await requireRole("lector");
  const sp = await searchParams;
  const status = typeof sp.estado === "string" && /^[a-z_]{3,20}$/.test(sp.estado) ? sp.estado : null;
  const rows = await getSql()<{ id: string; public_id: string; alert_type: string; status: string; public_label: string; title: string; priority_score: string; evidence_grade: string; amount_involved: string | null; currency: string; last_evaluated_at: Date }[]>`
    select id::text, public_id, alert_type, status, public_label, title, priority_score::text, evidence_grade, amount_involved::text,
           currency, last_evaluated_at
    from alerts ${status ? getSql()`where status = ${status}` : getSql()``}
    order by (status in ('interna','en_revision')) desc, priority_score desc limit 100`;
  return (
    <div>
      <AdminNav user={user} />
      <h1 className="text-2xl font-extrabold">Alertas</h1>
      <p className="mt-1 text-ink-muted">Cola editorial: las alertas en análisis interno o revisión no son públicas. Todo cambio queda en el historial público y en auditoría.</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {["", "interna", "en_revision", "publicada", "retirada", "aclarada"].map((s) => (
          <li key={s}><Link className="btn btn-quiet" href={s ? `/admin/alertas?estado=${s}` : "/admin/alertas"}>{s || "Todas"}</Link></li>
        ))}
      </ul>
      <ul className="mt-6 space-y-4">
        {rows.map((a) => (
          <li key={a.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <AlertLabel label={a.public_label} />
              <span className="text-sm font-bold">{a.status}</span>
              <span className="text-sm text-ink-muted">{ALERT_TYPE_LABEL[a.alert_type]} · prioridad {a.priority_score} · evidencia {a.evidence_grade} · {formatMoney(a.amount_involved, a.currency)} · {formatDateTime(a.last_evaluated_at)}</span>
            </div>
            <p className="mt-1 font-bold">{a.public_id}: {a.title}</p>
            {["publicada", "retirada", "aclarada"].includes(a.status) && <Link className="text-sm text-navy underline" href={`/radar/${a.public_id}`}>Ver ficha pública</Link>}
            {ROLE_RANK[user.role] >= ROLE_RANK.editor && <AlertStatusForm alertId={a.id} status={a.status} label={a.public_label} />}
          </li>
        ))}
        {rows.length === 0 && <li>No hay alertas con este filtro.</li>}
      </ul>
    </div>
  );
}
