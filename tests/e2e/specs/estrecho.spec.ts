import { test } from "@playwright/test";
import { expectNoHorizontalScroll, waitForData } from "./helpers";

/**
 * Teléfonos económicos de 320 px (límite inferior del diseño móvil). Se abren los desplegables
 * ("Ver los datos en una tabla", "¿Cómo hicimos esta comparación?") porque ahí aparecen fórmulas y
 * tablas anchas.
 */
const PAGES = [
  "/",
  "/buscar?q=laptop",
  "/compras",
  "/compras/DEMO-HFR-DEMO-2025-0001",
  "/radar",
  "/radar/A-2025-000001",
  "/presupuesto",
  "/obras",
  "/instituciones",
  "/proveedores",
  "/metodologia",
  "/fuentes",
];

test.describe("pantallas de 320 px", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "movil-360", "una sola pasada basta");
  });
  for (const path of PAGES) {
    test(`sin desplazamiento horizontal en ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(path);
      await waitForData(page);
      for (const summary of await page.locator("main details:not([open]) > summary").all()) {
        if (await summary.isVisible()) await summary.click({ timeout: 2000 }).catch(() => undefined);
      }
      await expectNoHorizontalScroll(page);
    });
  }
});
