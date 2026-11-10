import { expect, test } from "@playwright/test";
import { E2E_ADMIN, E2E_EDITOR } from "../global-setup";
import { expectAccessible } from "./helpers";

test.describe.configure({ mode: "serial" });

test("el panel exige iniciar sesión", async ({ page }) => {
  await page.goto("/admin/alertas");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Panel de administración" })).toBeVisible();
  await expectAccessible(page);
});

test("credenciales incorrectas muestran un error genérico", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Correo").fill(E2E_ADMIN.email);
  await page.getByLabel("Contraseña").fill("incorrecta-123456");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
});

test("administrador: ve estado, reglas editables y puede salir", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Correo").fill(E2E_ADMIN.email);
  await page.getByLabel("Contraseña").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Estado del sistema" })).toBeVisible();
  await expect(page.getByText("Tamaño de la base de datos")).toBeVisible();
  await page.getByRole("link", { name: "Reglas" }).click();
  await expect(page.getByRole("button", { name: "Crear nueva versión" }).first()).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "tirds_admin");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Strict");
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("rol lector no puede editar reglas", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Correo").fill(E2E_EDITOR.email);
  await page.getByLabel("Contraseña").fill(E2E_EDITOR.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/reglas");
  await expect(page.getByRole("heading", { name: "Reglas activas y umbrales" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear nueva versión" })).toHaveCount(0);
  await page.goto("/admin/auditoria");
  await expect(page).toHaveURL(/\/admin\?error=permiso/);
});

test("formulario de correcciones valida y confirma", async ({ page }) => {
  await page.goto("/correcciones?ref=A-2025-000001&tipo=alerta");
  await expect(page.getByLabel("Código, enlace o nombre del registro")).toHaveValue("A-2025-000001");
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByText("Describe el error o la aclaración con al menos 20 caracteres.")).toBeVisible();
  await page.getByLabel("¿Qué está mal o qué información aportas?").fill("La institución publicó una adenda que explica la diferencia de precio por instalación incluida.");
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recibimos tu solicitud" })).toBeVisible();
});
