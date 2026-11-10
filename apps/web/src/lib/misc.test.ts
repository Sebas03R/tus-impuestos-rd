import { describe, expect, it } from "vitest";
import { provinceKey } from "@/components/province-map";
import { csvCell } from "@/lib/api";
import { PROVINCES } from "@/lib/geo/provinces";

describe("CSV seguro", () => {
  it("escapa comillas, comas y saltos", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
  it("neutraliza fórmulas de hoja de cálculo", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
  });
});

describe("provincias", () => {
  it("tiene las 32 provincias de geoBoundaries", () => {
    expect(PROVINCES).toHaveLength(32);
  });
  it("normaliza nombres entre fuentes", () => {
    expect(provinceKey("Hermanas")).toBe(provinceKey("HERMANAS MIRABAL"));
    expect(provinceKey("La Estrelleta")).toBe(provinceKey("ELÍAS PIÑA"));
    expect(provinceKey("El Seybo")).toBe(provinceKey("EL SEIBO"));
    expect(provinceKey("Bahoruco")).toBe(provinceKey("BAORUCO"));
    expect(provinceKey("Monte Cristi")).toBe(provinceKey("MONTE CRISTI"));
    expect(provinceKey("San Cristóbal")).toBe(provinceKey("SAN CRISTOBAL"));
  });
  it("cada provincia del mapa tiene una clave única", () => {
    const keys = new Set(PROVINCES.map((p) => provinceKey(p.name)));
    expect(keys.size).toBe(32);
  });
});
