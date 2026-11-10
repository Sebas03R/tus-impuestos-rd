import "server-only";
import { cacheLife } from "next/cache";
import { getSql } from "@/lib/db";
import { getDataMode } from "@/lib/queries/system";

export type AlertListRow = {
  public_id: string;
  alert_type: string;
  title: string;
  summary: string;
  why_flagged: string;
  public_label: string;
  status: string;
  priority_score: string;
  evidence_grade: string;
  amount_involved: string | null;
  currency: string;
  event_date: Date | string | null;
  last_evaluated_at: Date;
  institution_name: string | null;
  institution_slug: string | null;
  process_code: string | null;
  missing_information: string[];
  evidence_documents: number;
  diff_pct: string | null;
  total: number;
};

export async function listAlerts(opts: {
  tipo?: string;
  etiqueta?: string;
  institucion?: number;
  page?: number;
  limit?: number;
}) {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const limit = Math.min(opts.limit ?? 20, 100);
  const page = opts.page ?? 1;
  const rows = await sql<AlertListRow[]>`
    select a.public_id, a.alert_type, a.title, a.summary, a.why_flagged, a.public_label, a.status,
           a.priority_score::text, a.evidence_grade, a.amount_involved::text, a.currency, a.event_date,
           a.last_evaluated_at, i.name as institution_name, i.slug as institution_slug, p.code as process_code,
           a.missing_information, a.metrics->>'diff_pct' as diff_pct,
           (select count(*)::int from alert_evidence e
             where e.alert_id = a.id and e.version = a.current_version and e.kind in ('documento', 'registro')) as evidence_documents,
           count(*) over()::int as total
    from alerts a
    left join institutions i on i.id = a.institution_id
    left join procurement_processes p on p.id = a.process_id
    where a.status = 'publicada' and (${demo}::boolean or not a.is_demo)
      ${opts.tipo ? sql`and a.alert_type = ${opts.tipo}` : sql``}
      ${opts.etiqueta ? sql`and a.public_label = ${opts.etiqueta}` : sql``}
      ${opts.institucion ? sql`and a.institution_id = ${opts.institucion}` : sql``}
    order by (a.public_label = 'revision_prioritaria') desc, a.priority_score desc, a.last_evaluated_at desc, a.id
    limit ${limit} offset ${(page - 1) * limit}`;
  const total = rows[0]?.total ?? 0;
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function alertTypeCounts() {
  "use cache";
  cacheLife("minutes");
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  return sql<{ alert_type: string; n: number }[]>`
    select alert_type, count(*)::int as n from alerts where status = 'publicada' and (${demo}::boolean or not is_demo)
    group by 1 order by 2 desc`;
}

export type AlertDetail = {
  id: string;
  public_id: string;
  alert_type: string;
  rule_code: string;
  rule_version: number;
  status: string;
  public_label: string;
  priority_score: string;
  priority_breakdown: Record<string, number | string>;
  evidence_grade: string;
  title: string;
  summary: string;
  why_flagged: string;
  possible_explanations: string[];
  missing_information: string[];
  limitations: string[];
  metrics: Record<string, unknown>;
  amount_involved: string | null;
  currency: string;
  event_date: Date | string | null;
  first_detected_at: Date;
  last_evaluated_at: Date;
  published_at: Date | null;
  current_version: number;
  is_demo: boolean;
  process_code: string | null;
  process_title: string | null;
  process_url: string | null;
  contract_code: string | null;
  contract_url: string | null;
  institution_name: string | null;
  institution_slug: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  rule_name: string | null;
  rule_public_description: string | null;
};

export type EvidenceRow = {
  id: string;
  kind: string;
  label: string;
  entity: string | null;
  entity_id: string | null;
  source_url: string | null;
  data: Record<string, unknown> | null;
  position: number;
};

export type StatusHistoryRow = {
  from_status: string | null;
  to_status: string;
  from_label: string | null;
  to_label: string;
  reason: string;
  actor: string;
  changed_at: Date;
};

/** Ficha pública: publicadas, retiradas o aclaradas. Internas/en revisión ⇒ null (404). */
export async function getAlert(publicId: string): Promise<{
  alert: AlertDetail;
  evidence: EvidenceRow[];
  history: StatusHistoryRow[];
} | null> {
  const sql = getSql();
  const demo = (await getDataMode()) === "demo";
  const [alert] = await sql<AlertDetail[]>`
    select a.id::text, a.public_id, a.alert_type, a.rule_code, a.rule_version, a.status, a.public_label,
           a.priority_score::text, a.priority_breakdown, a.evidence_grade, a.title, a.summary, a.why_flagged,
           a.possible_explanations, a.missing_information, a.limitations, a.metrics, a.amount_involved::text,
           a.currency, a.event_date, a.first_detected_at, a.last_evaluated_at, a.published_at, a.current_version,
           a.is_demo, p.code as process_code, p.title as process_title, p.official_url as process_url,
           c.code as contract_code, c.official_url as contract_url, i.name as institution_name,
           i.slug as institution_slug, s.id as supplier_id, s.name as supplier_name,
           r.name as rule_name, r.public_description as rule_public_description
    from alerts a
    left join procurement_processes p on p.id = a.process_id
    left join contracts c on c.id = a.contract_id
    left join institutions i on i.id = a.institution_id
    left join suppliers s on s.id = a.supplier_id
    left join detection_rules r on r.code = a.rule_code and r.version = a.rule_version
    where a.public_id = ${publicId} and (${demo}::boolean or not a.is_demo)
      and a.status in ('publicada', 'retirada', 'aclarada')`;
  if (!alert) return null;
  const [evidence, history] = await Promise.all([
    getEvidence(alert.id, alert.current_version),
    sql<StatusHistoryRow[]>`
      select from_status, to_status, from_label, to_label, reason, actor, changed_at
      from alert_status_history where alert_id = ${alert.id}::bigint order by changed_at`,
  ]);
  return { alert, evidence, history };
}

export async function getEvidence(alertId: string, version: number): Promise<EvidenceRow[]> {
  const sql = getSql();
  return sql<EvidenceRow[]>`
    select id::text, kind, label, entity, entity_id::text, source_url, data, position
    from alert_evidence where alert_id = ${alertId}::bigint and version = ${version}
    order by position, id`;
}

export async function getAlertEvidenceByPublicId(publicId: string) {
  const res = await getAlert(publicId);
  if (!res) return null;
  return { alert: res.alert, evidence: res.evidence };
}

export async function recentAlerts(limit = 3) {
  "use cache";
  cacheLife("minutes");
  return (await listAlerts({ limit, page: 1 })).rows;
}

export type AlertShareMeta = {
  public_id: string;
  title: string;
  alert_type: string;
  status: string;
  public_label: string;
  item: string | null;
  unit: string | null;
  paid: string | null;
  reference: string | null;
  diff_pct: string | null;
  n_peers: number | null;
  n_institutions: number | null;
  amount_involved: string | null;
  currency: string | null;
  event_date: Date | string | null;
  institution_name: string | null;
  institution_acronym: string | null;
};

/** Datos mínimos para compartir una alerta (metadatos e imagen de vista previa). */
export async function getAlertShareMeta(publicId: string): Promise<AlertShareMeta | null> {
  "use cache";
  cacheLife("hours");
  const sql = getSql();
  const [row] = await sql<AlertShareMeta[]>`
    select a.public_id, a.title, a.alert_type, a.status, a.public_label,
           a.metrics->>'item_description' as item, a.metrics->>'unit' as unit,
           a.metrics->>'contracted_price' as paid, a.metrics->>'reference_price' as reference,
           a.metrics->>'diff_pct' as diff_pct,
           (a.metrics->>'n_peers')::int as n_peers, (a.metrics->>'n_institutions')::int as n_institutions,
           a.amount_involved::text as amount_involved, a.currency, a.event_date,
           i.name as institution_name, i.acronym as institution_acronym
    from alerts a left join institutions i on i.id = a.institution_id
    where a.public_id = ${publicId} and a.status in ('publicada', 'retirada', 'aclarada')`;
  return row ?? null;
}
