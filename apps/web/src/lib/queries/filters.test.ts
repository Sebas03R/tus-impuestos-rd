import { describe, expect, it } from "vitest";
import { flattenParams, parseSearch, toQuery } from "@/lib/queries/filters";
import { hrefFor, looksLikeCode, queryWords } from "@/lib/queries/search";

describe("parseSearch", () => {
  it("acepta filtros válidos", () => {
    const p = parseSearch({ q: "  computadoras ", tipo: "proceso", anio: "2026", min: "1000", alertas: "1", orden: "monto", pagina: "2" });
    expect(p).toMatchObject({ q: "computadoras", tipo: "proceso", anio: 2026, min: 1000, alertas: true, orden: "monto", pagina: 2 });
  });
  it("descarta silenciosamente valores inválidos (nunca rompe la página)", () => {
    const p = parseSearch({ tipo: "hackeo", anio: "abc", limite: "5000", familia: "12", desde: "ayer", moneda: "pesos" });
    expect(p.tipo).toBeUndefined();
    expect(p.anio).toBeUndefined();
    expect(p.limite).toBeUndefined();
    expect(p.familia).toBeUndefined();
    expect(p.desde).toBeUndefined();
    expect(p.moneda).toBeUndefined();
  });
  it("limita el texto de búsqueda", () => {
    expect(parseSearch({ q: "a".repeat(500) }).q).toBeUndefined();
  });
  it("aplana arreglos y URLSearchParams", () => {
    expect(flattenParams({ q: ["uno", "dos"], x: undefined })).toEqual({ q: "uno" });
    expect(flattenParams(new URLSearchParams("q=a&q=b&tipo=obra"))).toEqual({ q: "a", tipo: "obra" });
  });
});

describe("toQuery", () => {
  it("omite vacíos y codifica", () => {
    expect(toQuery({ q: "ñandú & co", pagina: 2, vacio: "", nulo: null, falso: false, si: true })).toBe("?q=%C3%B1and%C3%BA+%26+co&pagina=2&si=1");
    expect(toQuery({})).toBe("");
  });
  it("permite sobrescribir y quitar claves", () => {
    expect(toQuery({ q: "x", pagina: 3 }, { pagina: undefined })).toBe("?q=x");
  });
});

describe("búsqueda: utilidades", () => {
  it("normaliza palabras sin tildes", () => {
    expect(queryWords("Educación  Física, MÉDICA")).toEqual(["educacion", "fisica", "medica"]);
  });
  it("detecta códigos oficiales", () => {
    expect(looksLikeCode("MINPRE-DAF-CM-2026-0049")).toBe(true);
    expect(looksLikeCode("INFOTEP-2026-03132")).toBe(true);
    expect(looksLikeCode("computadoras portátiles")).toBe(false);
    expect(looksLikeCode("ABC-DEF")).toBe(false);
  });
  it("construye enlaces públicos", () => {
    expect(hrefFor("proceso", "1", "A B/C")).toBe("/compras/A%20B%2FC");
    expect(hrefFor("contrato", "1", "X-1")).toBe("/contratos/X-1");
    expect(hrefFor("institucion", "7", null)).toBe("/instituciones/7");
  });
});
