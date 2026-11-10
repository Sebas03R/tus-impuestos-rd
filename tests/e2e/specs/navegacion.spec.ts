import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, isMobile, waitForData } from "./helpers";

test("la página de inicio explica el sitio y muestra el aviso de independencia", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "¿Por qué pagaron tanto?" })).toBeVisible();
  await expect(page.getByLabel("¿Qué quieres buscar?")).toBeVisible();
  await expect(page.getByText("Tus Impuestos RD es una iniciativa independiente. No es un portal oficial del Gobierno dominicano.")).toBeVisible();
  await expect(page.getByText("DATOS FICTICIOS DE DEMOSTRACIÓN")).toBeVisible();
  await waitForData(page);
  // Lo primero: la compra destacada con su medidor y el ranking de las más infladas.
  await expect(page.getByText("Sobreprecímetro · compra destacada")).toBeVisible();
  await expect(page.getByText(/Pagó (el doble|el triple|el cuádruple|[\d.]+ veces)/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Las compras más infladas" })).toBeVisible();
  const rows = page.locator("section#ranking ol > li");
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(10);
  // El orden alternativo funciona sin JavaScript (enlace).
  await page.getByRole("link", { name: "Más dinero de más" }).click();
  await expect(page.getByRole("heading", { name: "Donde más dinero se pagó de más" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page);
});

test("el menú lleva a cada sección principal", async ({ page }) => {
  await page.goto("/");
  const go = async (name: string) => {
    if (isMobile(page)) {
      await page.getByRole("button", { name: "Menú" }).click();
      await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name, exact: true }).click();
    } else {
      await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name, exact: true }).click();
    }
  };
  await go("Compras");
  await expect(page).toHaveURL(/\/compras$/);
  await expect(page.getByRole("heading", { level: 1, name: "Compras públicas" })).toBeVisible();
  await go("Alertas");
  await expect(page.getByRole("heading", { level: 1, name: "Compras públicas que merecen una revisión" })).toBeVisible();
  await go("Presupuesto");
  await expect(page.getByRole("heading", { level: 1, name: "¿Cuánto está gastando el Gobierno?" })).toBeVisible();
  await go("Obras");
  await expect(page.getByRole("heading", { level: 1, name: "¿Qué obras se construyen cerca de mí?" })).toBeVisible();
  await go("Ayuda");
  await expect(page.getByRole("heading", { name: "Glosario" })).toBeVisible();
});

test("teclado: el primer Tab muestra «Saltar al contenido»", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#contenido$/);
});

test("páginas inexistentes devuelven 404 amable", async ({ page }) => {
  const res = await page.goto("/esta-pagina-no-existe");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
});

for (const path of ["/compras", "/presupuesto", "/obras", "/instituciones", "/proveedores", "/metodologia", "/fuentes", "/ayuda", "/correcciones", "/acerca", "/privacidad", "/accesibilidad", "/api/docs"]) {
  test(`accesibilidad y diseño en ${path}`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await waitForData(page);
    await expect(page.locator("h1")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page);
  });
}
