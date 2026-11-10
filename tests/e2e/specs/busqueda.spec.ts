import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, waitForData } from "./helpers";

test("encontrar una compra en menos de tres interacciones desde la portada", async ({ page }) => {
  await page.goto("/");
  // 1) escribir y buscar
  await page.getByLabel("¿Qué quieres buscar?").fill("computadoras portátiles");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(/\/buscar\?q=/);
  await waitForData(page);
  await expect(page.getByRole("heading", { name: /resultados? para «computadoras portátiles»/ })).toBeVisible();
  // 2) abrir el primer resultado
  await page.getByRole("link", { name: /Ver detalles/ }).first().click();
  await expect(page).toHaveURL(/\/compras\//);
  await waitForData(page);
  await expect(page.getByText("Así se realizó esta compra")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Línea de tiempo" })).toBeVisible();
  await expect(page.getByText("Monto estimado").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("la búsqueda tolera tildes y errores de escritura", async ({ page }) => {
  await page.goto("/buscar?q=computdoras");
  await waitForData(page);
  await expect(page.getByText(/Mostramos resultados para/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Ver detalles/ }).first()).toBeVisible();
  await page.goto("/buscar?q=EDUCACION");
  await waitForData(page);
  await expect(page.getByRole("link", { name: /Ministerio Ficticio de Educación \(DEMO\)/ }).first()).toBeVisible();
});

test("búsqueda por código oficial", async ({ page }) => {
  await page.goto("/buscar?q=DEMO-HFR-DEMO-2025-0001");
  await waitForData(page);
  await expect(page.getByRole("heading", { name: "Coincidencia por código oficial" })).toBeVisible();
});

test("filtros: aplicar, ver chips y quitar", async ({ page }) => {
  await page.goto("/buscar?q=computadoras");
  await waitForData(page);
  await page.getByText("Filtros", { exact: true }).click();
  await page.getByLabel("Mostrar").selectOption("proceso");
  await page.getByLabel("Ordenar por").selectOption("monto");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/tipo=proceso/);
  await waitForData(page);
  const chips = page.getByRole("list", { name: "Filtros activos" });
  await expect(chips.getByRole("link", { name: /Mostrar: Proceso de compra/ })).toBeVisible();
  await chips.getByRole("link", { name: /Mostrar: Proceso de compra/ }).click();
  await expect(page).not.toHaveURL(/tipo=proceso/);
  await expectAccessible(page);
});

test("estado vacío cuando no hay resultados", async ({ page }) => {
  await page.goto("/buscar?q=zzzxqwv");
  await waitForData(page);
  await expect(page.getByRole("heading", { name: /No encontramos resultados para «zzzxqwv»/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Empezar una búsqueda nueva" })).toBeVisible();
});

test("descarga CSV con procedencia", async ({ request }) => {
  const res = await request.get("/api/search?q=computadoras&format=csv");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  expect(body).toContain("# Fuente:");
  expect(body).toContain("tipo_de_monto");
});

test("API: validación y errores RFC 7807", async ({ request }) => {
  const ok = await request.get("/api/search?q=computadoras&limite=5000");
  expect(ok.status()).toBe(200);
  const json = await ok.json();
  expect(json.meta.limit).toBeLessThanOrEqual(100);
  expect(json.meta.provider).toContain("no oficial");
  const missing = await request.get("/api/processes/NO-EXISTE-1");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/problem+json");
  const bad = await request.get("/api/suppliers/abc");
  expect(bad.status()).toBe(400);
  const spec = await request.get("/api/openapi.json");
  expect((await spec.json()).openapi).toBe("3.1.0");
  const status = await request.get("/api/system/data-status");
  expect((await status.json()).data.mode).toBe("demo");
});
