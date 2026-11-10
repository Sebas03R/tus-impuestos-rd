import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { INDEPENDENCE_NOTICE } from "@/lib/labels";

export const metadata: Metadata = { title: "Acerca del proyecto", alternates: { canonical: "/acerca" } };

export default function AboutPage() {
  return (
    <>
      <PageHeader eyebrow="Acerca" title="El dinero es público. La información también." />
      <div className="container-page prose-plain max-w-3xl py-10">
        <p className="border-2 border-navy p-4 font-bold">{INDEPENDENCE_NOTICE}</p>
        <h2>Qué es</h2>
        <p>Tus Impuestos RD es un observatorio ciudadano independiente, sin afiliación gubernamental ni partidaria. Reúne datos oficiales sobre compras, contratos, presupuesto y obras del Estado dominicano y los explica de forma sencilla.</p>
        <h2>Qué no es</h2>
        <ul>
          <li>No es un portal oficial: los datos oficiales están en los portales de cada institución, a los que siempre enlazamos.</li>
          <li>No señala culpables. Las alertas indican situaciones que merecen revisión, nunca conclusiones legales.</li>
          <li>No califica a instituciones, personas ni empresas como buenas, malas o corruptas.</li>
        </ul>
        <h2>Cómo se mantiene</h2>
        <p>El sistema descarga y analiza los datos automáticamente. El código y la metodología son públicos. Ver <Link href="/metodologia">metodología</Link> y <Link href="/fuentes">fuentes</Link>.</p>
        <h2 id="contacto">Contacto</h2>
        <p>Para reportar errores, aportar documentos o escribirnos, usa el <Link href="/correcciones">formulario de contacto y correcciones</Link>.</p>
      </div>
    </>
  );
}
