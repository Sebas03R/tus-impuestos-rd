import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { markTileDataUri } from "@/lib/brand";
import { dbConfigured, getSql } from "@/lib/db";
import { formatDate, formatMoney, sentenceCase, truncate } from "@/lib/format";

export const alt = "Ficha de una compra pública con datos oficiales de la DGCP";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const display = await readFile(join(process.cwd(), "assets/BigShoulders-Black.ttf"));

type Row = {
  title: string | null;
  institution: string | null;
  estimated_amount: string | null;
  currency: string | null;
  published_at: Date | null;
  modality: string | null;
  status: string | null;
};

/** Vista previa al compartir una compra: monto en grande, institución y fuente. Solo datos oficiales. */
export default async function Image(props: { params: Promise<{ id: string }> }) {
  const code = decodeURIComponent((await props.params).id);
  let row: Row | undefined;
  if (dbConfigured()) {
    try {
      [row] = await getSql()<Row[]>`
        select p.title, i.name as institution, p.estimated_amount::text, p.currency, p.published_at, p.modality, p.status
        from procurement_processes p left join institutions i on i.id = p.institution_id where p.code = ${code}`;
    } catch {
      row = undefined;
    }
  }
  const exception = /excepci/i.test(row?.modality ?? "");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#FFFFFF", padding: "40px 56px", borderTop: "20px solid #D21F1F" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={markTileDataUri()} width={44} height={44} alt="" />
            <div style={{ fontFamily: "Shoulders", fontSize: 40, color: "#111111" }}>TUS IMPUESTOS RD</div>
          </div>
          <div style={{ fontSize: 22, color: "#4A4A4A" }}>{code}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {exception && (
              <span style={{ fontSize: 22, color: "#FFFFFF", background: "#D21F1F", padding: "4px 12px" }}>POR EXCEPCIÓN, SIN LICITACIÓN PÚBLICA</span>
            )}
            <span style={{ fontSize: 26, color: "#111111" }}>{truncate(row?.institution ?? "", exception ? 45 : 80)}</span>
          </div>
          <div style={{ fontFamily: "Shoulders", fontSize: 54, color: "#111111", lineHeight: 1.02, textTransform: "uppercase" }}>
            {truncate(sentenceCase(row?.title) || `Compra ${code}`, 90)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#4A4A4A", letterSpacing: 2 }}>MONTO ESTIMADO</span>
            <span style={{ fontFamily: "Shoulders", fontSize: 104, color: "#111111", lineHeight: 1, background: "linear-gradient(transparent 58%, #FFD400 58%, #FFD400 94%, transparent 94%)", padding: "0 8px" }}>
              {row ? formatMoney(row.estimated_amount, row.currency, { compact: true }) : "Sin dato"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", maxWidth: 300, fontSize: 21, color: "#4A4A4A", textAlign: "right" }}>
            <span>{row?.published_at ? `Publicado el ${formatDate(row.published_at)}` : ""}</span>
            <span>Datos oficiales de la DGCP</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Shoulders", data: display, style: "normal", weight: 900 }] },
  );
}
