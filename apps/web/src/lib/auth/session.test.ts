import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({ getSql: vi.fn() }));

const { signSession, verifySession, ROLE_RANK } = await import("@/lib/auth/session");

describe("sesión de administración", () => {
  const user = { id: 7, email: "editora@example.org", name: "Editora", role: "editor" as const };

  it("firma y verifica el token", async () => {
    const token = await signSession(user);
    expect(await verifySession(token)).toEqual(user);
  });
  it("rechaza tokens alterados", async () => {
    const token = await signSession(user);
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "admin" })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verifySession("basura")).toBeNull();
  });
  it("jerarquía de roles", () => {
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeGreaterThan(ROLE_RANK.lector);
  });
});

describe("contraseñas argon2id", () => {
  it("verifica hashes PHC", async () => {
    const { hash } = await import("@node-rs/argon2");
    const { verifyPassword } = await import("@/lib/auth/password");
    const h = await hash("una-clave-larga-segura", { algorithm: 2 });
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "una-clave-larga-segura")).toBe(true);
    expect(await verifyPassword(h, "otra")).toBe(false);
    expect(await verifyPassword("no-es-hash", "x")).toBe(false);
  });
});
