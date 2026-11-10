import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, isoDay, relativeAge, sentenceCase, SIN_DATO, toNumber, truncate } from "@/lib/format";

describe("formatMoney", () => {
  it("formatea pesos dominicanos con separadores es-DO", () => {
    expect(formatMoney("1234567.89", "DOP")).toBe("RD$1,234,567.89");
    expect(formatMoney(470000, "DOP")).toBe("RD$470,000");
    expect(formatMoney("50.86", "DOP")).toBe("RD$50.86");
  });
  it("usa el prefijo de cada moneda y nunca convierte", () => {
    expect(formatMoney("1000.5", "USD")).toBe("US$1,000.50");
    expect(formatMoney("10", "XYZ", { decimals: 0 })).toBe("XYZ 10");
  });
  it("desconocido es «Sin dato», nunca cero", () => {
    expect(formatMoney(null, "DOP")).toBe(SIN_DATO);
    expect(formatMoney(undefined, "DOP")).toBe(SIN_DATO);
    expect(formatMoney("", "DOP")).toBe(SIN_DATO);
    expect(formatMoney("abc", "DOP")).toBe(SIN_DATO);
    expect(formatMoney(0, "DOP")).toBe("RD$0.00");
  });
  it("formato compacto en millones", () => {
    expect(formatMoney(12_500_000, "DOP", { compact: true })).toBe("RD$12.5 millones");
    expect(formatMoney(1_592_000_000_000, "DOP", { compact: true })).toBe("RD$1,592 mil millones");
  });
});

describe("fechas en America/Santo_Domingo", () => {
  it("convierte instantes UTC al día local (UTC-4)", () => {
    expect(formatDate(new Date("2026-11-07T02:30:00Z"))).toBe("6 de noviembre de 2026");
    expect(isoDay("2026-11-07T02:30:00Z")).toBe("2026-11-06");
  });
  it("las fechas sin hora son días calendario (sin corrimiento)", () => {
    expect(formatDate("2026-10-23")).toBe("23 de octubre de 2026");
    expect(isoDay("2026-01-01")).toBe("2026-01-01");
  });
  it("muestra hora local", () => {
    expect(formatDateTime("2026-11-09T19:46:00Z")).toMatch(/9 nov.*2026.*3:46/);
  });
  it("desconocido es «Sin dato»", () => {
    expect(formatDate(null)).toBe(SIN_DATO);
    expect(formatDate("no-es-fecha")).toBe(SIN_DATO);
  });
  it("antigüedad relativa", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    expect(relativeAge("2026-11-09T11:30:00Z", now)).toBe("hace menos de una hora");
    expect(relativeAge("2026-11-07T12:00:00Z", now)).toBe("hace 2 días");
  });
});

describe("números y textos", () => {
  it("porcentajes con signo", () => {
    expect(formatPercent("45.678")).toBe("+45.7 %");
    expect(formatPercent(-3)).toBe("-3 %");
    expect(formatPercent(null)).toBe(SIN_DATO);
  });
  it("toNumber y formatNumber", () => {
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(null)).toBeNull();
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
  it("sentenceCase solo transforma textos en mayúsculas sostenidas", () => {
    expect(sentenceCase("ADQUISICIÓN DE COMPUTADORAS PARA EL MINISTERIO")).toBe("Adquisición de computadoras para el ministerio");
    expect(sentenceCase("Compra de MINERD")).toBe("Compra de MINERD");
  });
  it("truncate respeta palabras", () => {
    expect(truncate("uno dos tres cuatro cinco", 12)).toBe("uno dos tres…");
  });
});
