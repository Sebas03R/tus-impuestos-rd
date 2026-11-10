import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ErrorState, ExternalA, PageHeader, Skeleton } from "@/components/ui";
import { dbConfigured } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getMethodology } from "@/lib/queries/fiscal";

export const metadata: Metadata = {
  title: "Metodología del Radar de Contrataciones",
  description: "Fuentes, reglas, umbrales, cálculos, limitaciones y política de correcciones del análisis automático.",
  alternates: { canonical: "/metodologia" },
};

const MODALITY_NAME: Record<string, string> = {
  debajo_umbral: "Compras por debajo del umbral / contratación directa sujeta al umbral",
  compra_menor: "Compras menores / contratación menor",
  comparacion_precios: "Comparación de precios / contratación simplificada",
  licitacion_restringida: "Licitación restringida",
  sorteo_obras: "Sorteo de obras",
  licitacion_publica: "Licitación pública",
};

export default function MethodologyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Transparencia del análisis"
        title="Cómo funciona el análisis"
        intro={<p>Publicamos todo lo que hace el sistema: de dónde salen los datos, qué reglas aplica, con qué parámetros y cuáles son sus límites. Primero en lenguaje sencillo; más abajo, el detalle técnico.</p>}
      />
      <div className="container-page prose-plain max-w-4xl py-10">
        <h2>En pocas palabras</h2>
        <ul>
          <li>Descargamos automáticamente los datos abiertos de la Dirección General de Contrataciones Públicas (DGCP) cuatro veces al día, y otras fuentes oficiales con la frecuencia que permiten.</li>
          <li>Guardamos cada registro con su identificador oficial, la fecha en que lo vimos y una copia del dato original.</li>
          <li>Un programa con reglas fijas (no un modelo de lenguaje) compara precios y busca patrones que merecen revisión.</li>
          <li>Solo publicamos una alerta si tiene identificación verificable del proceso, fuente oficial, regla aplicada, cálculos comprobables, fecha y limitaciones explícitas.</li>
          <li>Una alerta no es una acusación. Indica una situación que merece revisión; puede tener explicaciones legítimas.</li>
        </ul>

        <h2>Cómo comparamos precios</h2>
        <ol className="list-decimal space-y-2 pl-6">
          <li>Tomamos los artículos contratados que publica la DGCP: cantidad, unidad, precio unitario, ITBIS, otros impuestos y descuentos.</li>
          <li>Normalizamos la unidad de medida y calculamos el precio unitario <strong>antes de impuestos y después de descuentos</strong>, en pesos dominicanos (con la tasa del Banco Central de la fecha del contrato si estaba en otra moneda).</li>
          <li>Buscamos compras realmente comparables: misma categoría UNSPSC de 8 dígitos, misma unidad, especificaciones numéricas compatibles (por ejemplo 8 GB frente a 8 GB, 500 mg frente a 500 mg), los mismos servicios incluidos (instalación, transporte, garantía, licencias) y una descripción parecida. Coincidir en la categoría no basta.</li>
          <li>Usamos como referencia la <strong>mediana</strong> de esas compras, que no se deja arrastrar por valores extremos, y medimos qué tan dispersos están los precios.</li>
          <li>Si hay menos compras comparables que el mínimo configurado, o si los precios de referencia están muy dispersos, no publicamos: lo marcamos como información insuficiente.</li>
        </ol>
        <h3>Fórmulas</h3>
        <ul className="font-mono text-[0.9375rem] [overflow-wrap:anywhere]">
          <li>diferencia_unitaria = precio_contratado − precio_referencia</li>
          <li>variación_porcentual = ((precio_contratado / precio_referencia) − 1) × 100</li>
          <li>diferencia_total = diferencia_unitaria × cantidad</li>
        </ul>
        <p>La diferencia total estimada no es, por sí sola, un perjuicio económico. Puede deberse a especificaciones, garantías, transporte, instalación, volumen o urgencia.</p>
        <p>Cuando un artículo no declara impuestos, asumimos el caso más favorable a la institución (que el precio ya incluía el ITBIS), para no inflar diferencias.</p>

        <h2>Prioridad y confianza</h2>
        <p>La prioridad ordena qué revisar primero; no es una probabilidad de corrupción. Combina la desviación de precio comparable, la magnitud económica, indicadores de competencia y aspectos documentales. La confianza de la evidencia (A, B o C) se evalúa aparte. Nunca asignamos puntuaciones a personas, empresas o instituciones.</p>

        <h2>Cómo elegimos el caso del mes</h2>
        <p>Vigilamos temas de compra que suelen dar de qué hablar: habichuelas con dulce, uniformes y útiles escolares, Navidad, juguetes, publicidad, fiestas, vehículos, combustible, comida escolar, refrigerios, flores y bonos. Cada tema se identifica por palabras en el título del proceso. La portada destaca, sin intervención manual, el tema cuyo monto estimado publicado en los últimos 30 días más supera su promedio mensual del año anterior. Por eso cambia con la temporada. Destacar un tema no significa que sus compras tengan irregularidades: es un punto de partida para mirar los procesos, cada uno enlazado a su registro oficial.</p>

        <h2>Política de correcciones</h2>
        <p>Si una fuente modifica un contrato, guardamos la nueva versión, recalculamos y actualizamos la alerta. Si deja de cumplir los criterios, la marcamos como «aclarada» o «retirada» con su razón y fecha, y conservamos el historial. Cualquier persona puede <Link href="/correcciones">pedir una corrección o aportar documentos</Link>.</p>

        <h2>Limitaciones y falsos positivos</h2>
        <ul>
          <li>Los datos dependen de lo que registran las instituciones en el sistema de la DGCP; errores de carga en origen pueden generar diferencias aparentes.</li>
          <li>Las descripciones de artículos son texto libre: dos productos con nombres parecidos pueden ser técnicamente distintos.</li>
          <li>Sincronizamos desde enero de 2025; los procesos anteriores no están en nuestra base.</li>
          <li>Los umbrales usados son los publicados para cada período; instituciones con presupuesto pequeño pueden tener umbrales menores por ley, lo que hace nuestra regla de fraccionamiento más conservadora.</li>
          <li>No hay una fuente abierta de pagos: nunca afirmamos que algo fue pagado sin evidencia oficial.</li>
        </ul>

        <Suspense fallback={<Skeleton lines={6} label="Cargando reglas y umbrales…" />}>
          <Technical />
        </Suspense>
      </div>
    </>
  );
}

async function Technical() {
  await connection();
  if (!dbConfigured()) return <ErrorState>La base de datos no está configurada en este entorno.</ErrorState>;
  let m;
  try {
    m = await getMethodology();
  } catch {
    return <ErrorState />;
  }
  return (
    <>
      <h2 id="fuentes">Fuentes y frecuencia de actualización</h2>
      <ul>
        {m.sources.map((s) => (
          <li key={s.code}>
            <strong>{s.name}</strong>: {s.update_frequency ?? "frecuencia sin dato"} (estado: {s.status}).
          </li>
        ))}
      </ul>
      <p><Link href="/fuentes">Ver el estado detallado de cada fuente</Link>.</p>

      <h2 id="reglas">Reglas activas y sus parámetros (detalle técnico)</h2>
      <p>Los parámetros iniciales son experimentales y se calibran con validación histórica. Cada cambio crea una nueva versión; las alertas indican qué versión las generó.</p>
      {m.rules.length === 0 && <p>No hay reglas cargadas en este entorno.</p>}
      {m.rules.map((r) => (
        <section key={r.code} id={`regla-${r.code}`} className="card mt-4 p-5">
          <h3 className="!mt-0">{r.name} <span className="text-base font-normal text-ink-muted">· versión {r.version}{!r.active && " · inactiva"}</span></h3>
          <p>{r.public_description}</p>
          <details className="mt-3">
            <summary className="font-bold text-navy">Detalle técnico</summary>
            <p className="mt-2">{r.technical_description}</p>
            <pre tabIndex={0} aria-label={`Parámetros de ${r.name}`} className="mt-2 relative overflow-x-auto bg-mist p-3 text-sm">{JSON.stringify(r.params, null, 2)}</pre>
            <p className="text-sm text-ink-muted">Versión creada el {formatDate(r.created_at)}{r.change_note ? `: ${r.change_note}` : ""}.</p>
          </details>
        </section>
      ))}

      <h2 id="umbrales">Umbrales oficiales por período</h2>
      <p>Los umbrales de modalidades se aplican según la fecha de convocatoria de cada proceso. Nunca usamos umbrales actuales para evaluar procesos antiguos. Los procesos convocados desde el 29 de enero de 2026 se rigen por la Ley 47-25 (Decreto 52-26); los anteriores, por la Ley 340-06.</p>
      {m.thresholds.length === 0 ? (
        <p>No hay umbrales cargados en este entorno.</p>
      ) : (
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Tabla de umbrales (desplazable)">
          <table className="w-full text-left text-[0.9375rem]">
            <caption className="sr-only">Umbrales de modalidades de compra</caption>
            <thead>
              <tr className="border-b-2 border-line">
                <th scope="col" className="py-2 pr-3">Vigencia</th>
                <th scope="col" className="py-2 pr-3">Régimen</th>
                <th scope="col" className="py-2 pr-3">Modalidad</th>
                <th scope="col" className="py-2 pr-3">Objeto</th>
                <th scope="col" className="py-2 pr-3">Desde</th>
                <th scope="col" className="py-2 pr-3">Hasta</th>
                <th scope="col" className="py-2">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {m.thresholds.map((t, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="py-2 pr-3">{formatDate(t.valid_from, "short")} – {t.valid_to ? formatDate(t.valid_to, "short") : "vigente"}</td>
                  <td className="py-2 pr-3">{t.regime === "ley_47_25" ? "Ley 47-25" : "Ley 340-06"}</td>
                  <td className="py-2 pr-3">{MODALITY_NAME[t.modality] ?? t.modality}</td>
                  <td className="py-2 pr-3">{t.object_type === "obras" ? "Obras" : "Bienes y servicios"}</td>
                  <td className="tabular py-2 pr-3">{t.min_amount ? formatMoney(t.min_amount, t.currency, { decimals: 2 }) : "—"}</td>
                  <td className="tabular py-2 pr-3">{t.max_amount ? formatMoney(t.max_amount, t.currency, { decimals: 2 }) : "en adelante"}</td>
                  <td className="py-2">{t.source_url ? <ExternalA href={t.source_url}>{t.source_name}</ExternalA> : t.source_name}{!t.verified && " (no verificado)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
