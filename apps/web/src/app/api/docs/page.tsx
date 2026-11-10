import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { openapiSpec } from "@/lib/openapi";

export const metadata: Metadata = { title: "API de datos", description: "Documentación de la API pública de Tus Impuestos RD.", alternates: { canonical: "/api/docs" } };

export default function ApiDocsPage() {
  const spec = openapiSpec();
  return (
    <>
      <PageHeader eyebrow="Reutilización de datos" title="API pública" intro={<p>{spec.info.description}</p>} />
      <div className="container-page prose-plain max-w-4xl py-10">
        <p>
          Especificación completa en formato OpenAPI 3.1: <a href="/api/openapi.json">/api/openapi.json</a>. Las listas aceptan{" "}
          <code>?format=csv</code>. Límite: 100 resultados por página y 120 consultas por minuto en búsquedas.
        </p>
        <h2>Rutas</h2>
        <ul className="!list-none !pl-0 space-y-3">
          {Object.entries(spec.paths).map(([path, def]) => (
            <li key={path} className="card p-4">
              <p className="font-mono font-bold">GET {path}</p>
              <p>{def.get.summary}</p>
              {def.get.parameters.length > 0 && (
                <p className="text-sm text-ink-muted">
                  Parámetros: {def.get.parameters.map((p) => (p as { name: string }).name).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
        <h2>Ejemplo</h2>
        <pre tabIndex={0} aria-label="Ejemplo de consulta" className="relative overflow-x-auto whitespace-pre-wrap break-all bg-mist p-3 text-sm">curl &quot;/api/search?q=computadoras&amp;tipo=proceso&amp;limite=5&quot;</pre>
        <p>Los errores siguen el formato RFC 7807 (<code>application/problem+json</code>).</p>
      </div>
    </>
  );
}
