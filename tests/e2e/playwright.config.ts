import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la base de DEMOSTRACIÓN (datos ficticios, `tirds_demo`).
 * Antes: `./scripts/seed-demo.sh` y `pnpm -C apps/web build`.
 */
const PORT = 3011;
export const DEMO_DB_WEB = process.env.E2E_DATABASE_URL_WEB ?? "postgres://web_app:web_app_local_only@localhost:54330/tirds_demo";
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "./specs",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-DO",
    timezoneId: "America/Santo_Domingo",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "movil-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 }, launchOptions: executablePath ? { executablePath } : undefined } },
    { name: "escritorio-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, launchOptions: executablePath ? { executablePath } : undefined } },
  ],
  webServer: {
    command: `pnpm -C ../../apps/web exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL_WEB: DEMO_DB_WEB,
      SESSION_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
      SITE_URL: `http://localhost:${PORT}`,
      NODE_ENV: "production",
    },
  },
});
