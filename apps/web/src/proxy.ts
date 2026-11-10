import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege /admin antes de renderizar: sin sesión válida se redirige al login.
 * La verificación completa (usuario activo, rol) se repite en el servidor en cada página y acción.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();
  const token = request.cookies.get("tirds_admin")?.value;
  const secret = process.env.SESSION_SECRET;
  let valid = false;
  if (token && secret && secret.length >= 32) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "tirds", audience: "tirds-admin", algorithms: ["HS256"] });
      valid = true;
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
