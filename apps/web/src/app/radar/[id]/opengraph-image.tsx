import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { markTileDataUri } from "@/lib/brand";
import { formatTimes, timesFromPct, timesPhrase, unitSingular } from "@/components/meters";
import { dbConfigured } from "@/lib/db";
import { formatMoney, sentenceCase, truncate } from "@/lib/format";
import { ALERT_TYPE_LABEL } from "@/lib/labels";
import { getAlertShareMeta, type AlertShareMeta } from "@/lib/queries/alerts";

export const alt = "Alerta del Radar de Contrataciones con datos oficiales de la DGCP";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const display = await readFile(join(process.cwd(), "assets/BigShoulders-Black.ttf"));

const INK = "#111111";
const RED = "#D21F1F";
const RED_TEXT = "#B0151B";
const YELLOW = "#FFD400";

function Brand({ id }: { id: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <img src={markTileDataUri()} width={44} height={44} alt="" />
        <div style={{ fontFamily: "Shoulders", fontSize: 40, color: INK }}>TUS IMPUESTOS RD</div>
      </div>
      <div style={{ fontSize: 22, color: "#4A4A4A" }}>{id}</div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 21, color: "#4A4A4A" }}>
      <span>Datos oficiales de la DGCP · cálculo abierto</span>
      <span>Una alerta merece revisión; no prueba una irregularidad</span>
    </div>
  );
}

function PriceCard({ m, times }: { m: AlertShareMeta; times: number }) {
  const per = unitSingular(m.unit);
  const payer = m.institution_acronym || truncate(m.institution_name ?? "esta institución", 28);
  return (
    <div style={{ display: "flex", flex: 1, gap: 48, alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
        <div style={{ fontFamily: "Shoulders", fontSize: 230, color: RED_TEXT, lineHeight: 0.9 }}>{`×${formatTimes(times)}`}</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: INK, marginTop: 12 }}>{`Pagó ${timesPhrase(times)}`}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 14 }}>
        <div style={{ fontFamily: "Shoulders", fontSize: 60, color: INK, lineHeight: 1, textTransform: "uppercase" }}>
          {truncate(sentenceCase(m.item) || "Artículo", 48)}
        </div>
        <div style={{ fontSize: 24, color: INK }}>{truncate(m.institution_name ?? "", 70)}</div>
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, background: YELLOW, border: `4px solid ${INK}`, padding: "12px 16px" }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>LO QUE PAGARON OTROS</span>
            <span style={{ fontFamily: "Shoulders", fontSize: 54, color: INK }}>{formatMoney(m.reference, m.currency)}</span>
            <span style={{ fontSize: 18 }}>{`por ${per}`}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, background: RED, border: `4px solid ${INK}`, padding: "12px 16px", color: "#FFFFFF" }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{`LO QUE PAGÓ ${payer.toUpperCase()}`}</span>
            <span style={{ fontFamily: "Shoulders", fontSize: 54 }}>{formatMoney(m.paid, m.currency)}</span>
            <span style={{ fontSize: 18 }}>{`por ${per}`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GenericCard({ m }: { m: AlertShareMeta }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 18 }}>
      <div style={{ display: "flex", alignSelf: "flex-start", fontFamily: "Shoulders", background: RED, color: "#FFFFFF", fontSize: 34, padding: "2px 14px" }}>
        {(ALERT_TYPE_LABEL[m.alert_type] ?? "Alerta").toUpperCase()}
      </div>
      <div style={{ fontFamily: "Shoulders", fontSize: 72, color: INK, lineHeight: 1 }}>{truncate(m.title, 90)}</div>
      <div style={{ fontSize: 28, color: INK }}>{truncate(m.institution_name ?? "", 80)}</div>
      {m.amount_involved && (
        <div style={{ fontFamily: "Shoulders", fontSize: 64, color: INK }}>{formatMoney(m.amount_involved, m.currency, { compact: true })}</div>
      )}
    </div>
  );
}

/** Vista previa al compartir una alerta: la cifra que importa, en grande, con su fuente y su advertencia. */
export default async function Image(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  let m: AlertShareMeta | null = null;
  if (dbConfigured()) {
    try {
      m = await getAlertShareMeta(id);
    } catch {
      m = null;
    }
  }
  const times = m ? timesFromPct(m.diff_pct) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 24, background: "#FFFFFF", padding: "40px 56px", borderTop: `20px solid ${RED}` }}>
        <Brand id={id} />
        {m && m.alert_type === "precio" && times !== null && m.paid && m.reference ? (
          <PriceCard m={m} times={times} />
        ) : m ? (
          <GenericCard m={m} />
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", fontFamily: "Shoulders", fontSize: 96 }}>¿POR QUÉ PAGARON TANTO?</div>
        )}
        <Footer />
      </div>
    ),
    { ...size, fonts: [{ name: "Shoulders", data: display, style: "normal", weight: 900 }] },
  );
}
