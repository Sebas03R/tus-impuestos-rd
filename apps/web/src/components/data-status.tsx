import { connection } from "next/server";
import { Clock, TriangleAlert } from "lucide-react";
import { dbConfigured } from "@/lib/db";
import { formatDateTime, relativeAge } from "@/lib/format";
import { getDataStatus, STALE_HOURS } from "@/lib/queries/system";

/** Línea de procedencia y frescura de los datos (fuente + fecha + estado). */
export async function DataFreshness({ variant = "inline" }: { variant?: "inline" | "footer" }) {
  await connection();
  if (!dbConfigured()) {
    return <p className="text-sm">Base de datos no configurada en este entorno.</p>;
  }
  let status;
  try {
    status = await getDataStatus();
  } catch {
    return (
      <p className="flex items-center gap-2 text-sm" role="status">
        <TriangleAlert aria-hidden="true" className="size-4" /> No se pudo consultar el estado de actualización.
      </p>
    );
  }
  const last = status.dgcpLastSuccess;
  if (variant === "footer") {
    return (
      <p className="text-sm">
        Última actualización de compras públicas (DGCP):{" "}
        <strong>{last ? `${formatDateTime(last)} (${relativeAge(last)})` : "sin sincronizaciones exitosas aún"}</strong>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
      <span className="inline-flex items-center gap-1.5">
        <Clock aria-hidden="true" className="size-4" />
        Fuente: Dirección General de Contrataciones Públicas (DGCP).
      </span>
      <span>
        Datos al <strong className="text-ink">{last ? formatDateTime(last) : "—"}</strong>
      </span>
      {status.stale && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber-soft px-2.5 font-bold text-amber-text">
          <TriangleAlert aria-hidden="true" className="size-4" />
          {last
            ? `Datos desactualizados: más de ${STALE_HOURS} horas sin sincronizar`
            : "Todavía no hay una sincronización completa"}
        </span>
      )}
    </div>
  );
}

export async function DemoBanner() {
  await connection();
  if (!dbConfigured()) return null;
  try {
    const { getDataMode } = await import("@/lib/queries/system");
    if ((await getDataMode()) !== "demo") return null;
  } catch {
    return null;
  }
  return (
    <div role="note" className="bg-amber-text px-4 py-2 text-center font-bold text-white">
      DATOS FICTICIOS DE DEMOSTRACIÓN — no corresponden a instituciones, empresas ni contratos reales.
    </div>
  );
}
