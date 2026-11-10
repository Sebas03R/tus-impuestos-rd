import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, waitForData } from "./helpers";

const DISCLAIMER = "Esta alerta indica una situación que merece revisión. No demuestra por sí sola una irregularidad.";

test("Radar: lista ordenada con aviso y tarjetas que responden las preguntas", async ({ page }) => {
  await page.goto("/radar");
  await waitForData(page);
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  const first = page.locator("article").first();
  await expect(first.getByText("¿Qué ocurrió?")).toBeVisible();
  await expect(first.getByText("¿Por qué llamó la atención?")).toBeVisible();
  await expect(first.getByText("¿De cuánto dinero estamos hablando?")).toBeVisible();
  await expect(first.getByText("¿Qué documentos respaldan el análisis?")).toBeVisible();
  // La primera es la prioritaria.
  await expect(first.getByText("Revisión prioritaria")).toBeVisible();
  await page.getByRole("navigation", { name: "Tipos de alerta" }).getByRole("link", { name: /Competencia limitada/ }).click();
  await expect(page).toHaveURL(/tipo=competencia_limitada/);
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("detalle de alerta de precio: cifras, explicación y pruebas", async ({ page }) => {
  await page.goto("/radar/A-2025-000001");
  await waitForData(page);
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await expect(page.getByText("Precio contratado por unidad").first()).toBeVisible();
  await expect(page.getByText("Precio de referencia por unidad").first()).toBeVisible();
  await expect(page.getByText("Diferencia total estimada").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Por qué estamos mostrando esta alerta?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Qué podría explicar la diferencia?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Consulta las pruebas" })).toBeVisible();
  await page.getByText("¿Cómo hicimos esta comparación?").click();
  await expect(page.getByText(/Compras usadas como referencia/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("alertas internas o inexistentes no son públicas", async ({ page }) => {
  const res = await page.goto("/radar/A-0000-999999");
  await waitForData(page);
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
  expect([200, 404]).toContain(res?.status());
});

test("informe imprimible", async ({ page }) => {
  await page.goto("/radar/A-2025-000001/informe");
  await waitForData(page);
  await expect(page.getByRole("button", { name: "Imprimir o guardar PDF" })).toBeVisible();
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
});

test("ficha de compra: etapas, montos sin sumar etapas, contratos y enlaces oficiales", async ({ page }) => {
  await page.goto("/compras/DEMO-HFR-DEMO-2025-0001");
  await waitForData(page);
  await expect(page.getByText("Así se realizó esta compra")).toBeVisible();
  for (const stage of ["Publicado", "Ofertas recibidas", "Adjudicado", "Contratado", "Pagado"]) {
    await expect(page.getByRole("list", { name: "Etapas de esta compra" }).getByText(stage).first()).toBeVisible();
  }
  await expect(page.getByText("Sin evidencia oficial de pago")).toBeVisible();
  await expect(page.getByText("Monto contratado").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Compartir esta compra" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documentos" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("instituciones, proveedores y obras tienen fichas navegables", async ({ page }) => {
  await page.goto("/instituciones");
  await waitForData(page);
  await page.getByRole("link", { name: /Ministerio Ficticio de Educación/ }).click();
  await waitForData(page);
  await expect(page.getByRole("heading", { level: 1, name: /Ministerio Ficticio de Educación/ })).toBeVisible();
  await expect(page.getByText(/contratación pública/)).toBeVisible();
  await expectAccessible(page);

  await page.goto("/proveedores");
  await waitForData(page);
  await page.getByRole("link", { name: /Proveedor Ficticio/ }).first().click();
  await waitForData(page);
  await expect(page.getByText("Registro de Proveedores del Estado (RPE)")).toBeVisible();
  await expect(page.getByText(/No publicamos teléfonos, correos/)).toBeVisible();
  await expectAccessible(page);

  await page.goto("/obras");
  await waitForData(page);
  await expect(page.getByRole("img", { name: /Mapa de proyectos de inversión por provincia/ })).toBeVisible();
  await page.locator("#listado").getByRole("link").first().click();
  await waitForData(page);
  await expect(page.getByText("Proyecto de inversión pública")).toBeVisible();
  await expectAccessible(page);
});

test("presupuesto separa universos y explica los términos", async ({ page }) => {
  await page.goto("/presupuesto");
  await waitForData(page);
  await expect(page.getByText("Presupuestado no significa gastado.").first()).toBeVisible();
  await expect(page.getByLabel("Universo de datos")).toBeVisible();
  await expect(page.getByText("Pagado").first()).toBeVisible();
  await expectAccessible(page);
});
