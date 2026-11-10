import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Accesibilidad", alternates: { canonical: "/accesibilidad" } };

export default function AccessibilityPage() {
  return (
    <>
      <PageHeader eyebrow="Accesibilidad" title="Una página para todas las personas" />
      <div className="container-page prose-plain max-w-3xl py-10">
        <p>Diseñamos Tus Impuestos RD para cumplir, en la medida aplicable, las pautas WCAG 2.2 nivel AA.</p>
        <ul>
          <li>Letra Atkinson Hyperlegible, creada para personas con baja visión, con tamaño base de 18 píxeles.</li>
          <li>Colores con contraste verificado; los estados nunca se indican solo con color: siempre llevan texto e ícono.</li>
          <li>Todo se puede usar con teclado y lectores de pantalla. El enlace «Saltar al contenido» aparece al presionar Tab.</li>
          <li>Botones y enlaces de al menos 48 píxeles de alto para facilitar el uso en celulares.</li>
          <li>Puedes ampliar el texto hasta un 200 % sin perder contenido.</li>
          <li>Respetamos la preferencia de reducir movimiento del sistema.</li>
          <li>Cada gráfico tiene una tabla con los mismos datos.</li>
        </ul>
        <h2>¿Encontraste una barrera?</h2>
        <p>Cuéntanos qué página y qué ocurrió en el <Link href="/correcciones?tipo=otro">formulario de contacto</Link>.</p>
      </div>
    </>
  );
}
