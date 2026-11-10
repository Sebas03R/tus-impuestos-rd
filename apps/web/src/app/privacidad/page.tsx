import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Política de privacidad", alternates: { canonical: "/privacidad" } };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Privacidad" title="Política de privacidad" />
      <div className="container-page prose-plain max-w-3xl py-10">
        <h2>Lo que publicamos</h2>
        <p>Publicamos información de interés público difundida por el propio Estado dominicano conforme a la Ley 200-04 General de Libre Acceso a la Información Pública y a las normas de datos abiertos. De los proveedores mostramos solo lo pertinente para entender la contratación: razón social, número de Registro de Proveedores del Estado y, para personas jurídicas, su RNC.</p>
        <p>No publicamos teléfonos, correos, direcciones de contacto ni cédulas de personas físicas, aunque aparezcan en las fuentes. Esto sigue el principio de minimización de la Ley 172-13 sobre protección de datos de carácter personal.</p>
        <h2>Lo que recogemos de los visitantes</h2>
        <ul>
          <li>No exigimos registro ni usamos cookies de publicidad o rastreo.</li>
          <li>Para prevenir abusos, guardamos un código irreversible (hash) derivado de la dirección IP al enviar formularios o usar la API de forma intensiva. No guardamos la IP en claro.</li>
          <li>Si nos escribes por el formulario de correcciones, el nombre y el correo son opcionales y solo se usan para responderte.</li>
        </ul>
        <h2>Correcciones y supresión</h2>
        <p>Si consideras que publicamos un dato personal innecesario o incorrecto, escríbenos por el formulario de correcciones. Revisaremos la solicitud y, si corresponde, retiraremos o corregiremos la información, dejando constancia del cambio cuando afecte a un análisis.</p>
        <h2>Reutilización</h2>
        <p>Las descargas preservan la procedencia y las condiciones de uso de cada fuente oficial.</p>
      </div>
    </>
  );
}
