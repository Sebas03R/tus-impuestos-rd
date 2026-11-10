import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { markTileDataUri } from "@/lib/brand";

export const alt = "Tus Impuestos RD — ¿Por qué pagaron tanto? Compras del Estado dominicano mucho más caras que lo normal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Big Shoulders (SIL Open Font License), la misma condensada de cartel de los titulares del sitio.
const display = await readFile(join(process.cwd(), "assets/BigShoulders-Black.ttf"));

/** Cartel para redes: rojo pancarta, amarillo de etiqueta de precio y tinta negra. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#FFFFFF", padding: 64, borderTop: "20px solid #D21F1F" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={markTileDataUri()} width={56} height={56} alt="" />
          <div style={{ fontFamily: "Shoulders", fontSize: 48, color: "#111111" }}>TUS IMPUESTOS RD</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignSelf: "flex-start", fontFamily: "Shoulders", background: "#D21F1F", color: "#FFFFFF", fontSize: 38, padding: "4px 14px" }}>
            ES TU DINERO
          </div>
          <div style={{ fontFamily: "Shoulders", fontSize: 132, color: "#111111", lineHeight: 1.02, marginTop: 18 }}>¿POR QUÉ PAGARON TANTO?</div>
          <div style={{ fontSize: 30, color: "#111111", marginTop: 20 }}>Compras del Estado comparadas con lo que pagaron otras instituciones por lo mismo.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24 }}>
          <span style={{ background: "#FFD400", color: "#111111", fontWeight: 800, padding: "6px 12px", border: "4px solid #111111" }}>Datos oficiales · cálculos abiertos</span>
          <span style={{ color: "#B0151B", fontWeight: 700 }}>Iniciativa independiente · no oficial</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Shoulders", data: display, style: "normal", weight: 900 }] },
  );
}
