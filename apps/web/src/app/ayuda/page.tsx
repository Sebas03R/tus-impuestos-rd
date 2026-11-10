import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { NAV } from "@/components/nav";

export const metadata: Metadata = {
  title: "Ayuda y glosario",
  description: "Tutoriales cortos para buscar compras, leer una licitación, entender alertas y comprobar las fuentes.",
  alternates: { canonical: "/ayuda" },
};

const GUIDES: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "buscar",
    title: "Cómo buscar una compra",
    body: (
      <ol className="list-decimal space-y-1 pl-6">
        <li>Ve a <Link href="/buscar">Buscar</Link> o usa el buscador de la página de inicio.</li>
        <li>Escribe lo que te interesa: un producto («computadoras»), una institución («Ministerio de Salud»), una empresa, su RNC o el código del proceso.</li>
        <li>Pulsa «Ver detalles» en el resultado para ver cómo se realizó la compra.</li>
        <li>Si hay muchos resultados, abre «Filtros» para elegir institución, fechas, tipo de compra o monto.</li>
      </ol>
    ),
  },
  {
    id: "licitacion",
    title: "Cómo leer una licitación",
    body: (
      <p>Cada ficha muestra quién compra, qué compra, por qué modalidad y en qué etapa está. La línea de tiempo indica cuándo se publicó, cuándo se recibieron ofertas, cuándo se adjudicó y cuándo se firmó el contrato. Los documentos enlazan al portal oficial, donde están el pliego de condiciones y las actas.</p>
    ),
  },
  { id: "adjudicacion", title: "Qué significa adjudicación", body: <p>Es la decisión de la institución de elegir a un proveedor para la compra. Después de adjudicar se firma el contrato.</p> },
  { id: "contratado", title: "Qué significa contratado", body: <p>Es el monto que figura en el contrato firmado. No significa que ya se pagó: el pago puede ocurrir después, por partes o no completarse.</p> },
  { id: "referencia", title: "Qué es un precio de referencia", body: <p>Es la mediana de lo que pagaron otras instituciones por artículos equivalentes en fechas cercanas. La usamos para detectar diferencias que merecen revisión, no para fijar un «precio justo».</p> },
  { id: "alerta", title: "Qué significa una alerta", body: <p>Una alerta indica una situación que merece revisión. No demuestra por sí sola una irregularidad. Cada alerta explica qué pasó, por qué llamó la atención, cuánto dinero involucra, qué documentos la respaldan y qué información falta.</p> },
  { id: "fuente", title: "Cómo comprobar una fuente", body: <p>Todas las fichas tienen el botón «Ver en el portal oficial» y el código oficial del proceso. Puedes copiar ese código y buscarlo en el portal de Compras Dominicana para comparar los datos.</p> },
  { id: "error", title: "Cómo reportar un error", body: <p>Usa el <Link href="/correcciones">formulario de correcciones</Link>. Indica el código del registro y, si tienes, un enlace al documento oficial que aclara el caso.</p> },
];

const GLOSSARY: [string, string][] = [
  ["Adjudicación", "Decisión de elegir al proveedor ganador de una compra."],
  ["Contrato", "Acuerdo firmado entre la institución y el proveedor, con el monto contratado."],
  ["DGCP", "Dirección General de Contrataciones Públicas, órgano rector de las compras del Estado."],
  ["Devengado", "Gasto reconocido porque el bien o servicio ya se recibió; no significa que se pagó."],
  ["ITBIS", "Impuesto a las transferencias de bienes industrializados y servicios (18 % en general)."],
  ["Licitación pública", "Modalidad abierta a todos los proveedores para compras de mayor monto."],
  ["Mediana", "Valor del medio cuando se ordenan los precios; no se deja influir por valores extremos."],
  ["Modalidad", "Forma de comprar según el monto y el caso: compra menor, comparación de precios, licitación, excepción…"],
  ["Monto estimado", "Lo que la institución calculó gastar al publicar la compra."],
  ["Pliego de condiciones", "Documento con los requisitos de lo que se quiere comprar y cómo se evaluarán las ofertas."],
  ["Presupuesto vigente", "Presupuesto aprobado más las modificaciones del año."],
  ["Proveedor", "Empresa o persona inscrita en el Registro de Proveedores del Estado (RPE) que vende al Estado."],
  ["RNC", "Registro Nacional de Contribuyentes: identificador fiscal de las empresas."],
  ["SNIP", "Sistema Nacional de Inversión Pública: código de los proyectos de inversión."],
  ["UNSPSC", "Clasificación internacional de productos y servicios que usa la DGCP para categorizar artículos."],
];

export default function HelpPage() {
  return (
    <>
      <PageHeader eyebrow="Ayuda" title="¿Cómo usar Tus Impuestos RD?" intro={<p>Guías cortas para entender la información, aunque nunca hayas usado un portal de datos públicos.</p>} />
      <div className="container-page grid gap-10 py-10 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Temas de ayuda" className="lg:sticky lg:top-28 lg:self-start">
          <ul className="space-y-1">
            {GUIDES.map((g) => (
              <li key={g.id}><a className="flex min-h-12 items-center font-bold text-navy underline" href={`#${g.id}`}>{g.title}</a></li>
            ))}
            <li><a className="flex min-h-12 items-center font-bold text-navy underline" href="#glosario">Glosario</a></li>
            <li><a className="flex min-h-12 items-center font-bold text-navy underline" href="#mapa-del-sitio">Mapa del sitio</a></li>
          </ul>
        </nav>
        <div className="max-w-3xl space-y-6">
          {GUIDES.map((g) => (
            <section key={g.id} id={g.id} aria-labelledby={`${g.id}-t`} className="card p-5">
              <h2 id={`${g.id}-t`} className="text-xl font-bold">{g.title}</h2>
              <div className="prose-plain mt-2">{g.body}</div>
            </section>
          ))}
          <section id="glosario" aria-labelledby="glosario-t">
            <h2 id="glosario-t" className="text-2xl font-extrabold">Glosario</h2>
            <dl className="mt-4 divide-y divide-line">
              {GLOSSARY.map(([t, d]) => (
                <div key={t} className="py-3">
                  <dt className="font-bold">{t}</dt>
                  <dd className="text-ink-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section id="mapa-del-sitio" aria-labelledby="mapa-t">
            <h2 id="mapa-t" className="text-2xl font-extrabold">Mapa del sitio</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {[...NAV, { href: "/instituciones", label: "Instituciones" }, { href: "/proveedores", label: "Proveedores" }, { href: "/metodologia", label: "Metodología" }, { href: "/fuentes", label: "Fuentes oficiales" }, { href: "/correcciones", label: "Contacto y correcciones" }].map((l) => (
                <li key={l.href}><Link className="flex min-h-12 items-center font-bold text-navy underline" href={l.href}>{l.label}</Link></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
