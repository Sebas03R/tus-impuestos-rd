import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Sin violaciones de accesibilidad graves o críticas (WCAG 2.2 A/AA). */
export async function expectAccessible(page: Page) {
  // Los metadatos de páginas dinámicas se transmiten en streaming: esperar a que el <title> llegue.
  await page.waitForFunction(() => document.title.length > 0, undefined, { timeout: 10_000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map((v) => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
}

/** Sin desplazamiento horizontal (diseño móvil). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function waitForData(page: Page) {
  await expect(page.locator('[role="status"][aria-live="polite"]:has-text("Cargando")')).toHaveCount(0, { timeout: 15_000 });
}

export function isMobile(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 1024;
}
