import { connection } from "next/server";
import { dbConfigured, getSql } from "@/lib/db";

export async function GET() {
  await connection();
  let db = "no_configurada";
  if (dbConfigured()) {
    try {
      await getSql()`select 1`;
      db = "ok";
    } catch {
      db = "error";
    }
  }
  return Response.json({ status: db === "ok" ? "ok" : "degradado", db, time: new Date().toISOString() }, {
    status: db === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
