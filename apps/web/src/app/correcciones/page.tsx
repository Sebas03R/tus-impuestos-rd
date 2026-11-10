import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { flattenParams } from "@/lib/queries/filters";
import { CorrectionForm } from "./form";

export const metadata: Metadata = {
  title: "Contacto y solicitudes de corrección",
  description: "Reporta un error, aporta documentos aclaratorios o escríbenos.",
  alternates: { canonical: "/correcciones" },
};

export default function CorrectionsPage(props: PageProps<"/correcciones">) {
  return (
    <>
      <PageHeader
        eyebrow="Contacto"
        title="Reportar un error o aportar información"
        intro={<p>Si un dato está mal, si una alerta tiene explicación o si representas a una institución o empresa mencionada, cuéntanos. Toda corrección queda registrada en el historial público del registro.</p>}
      />
      <div className="container-page grid gap-10 py-10 lg:grid-cols-[1fr_22rem]">
        <Suspense fallback={<CorrectionForm />}>
          <FormWithParams searchParams={props.searchParams} />
        </Suspense>
        <aside className="space-y-4">
          <div className="card p-5">
            <h2 className="text-lg font-bold">Qué pasa después</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              <li>Revisamos la solicitud contra la fuente oficial.</li>
              <li>Si el dato de origen cambió o hay una aclaración documentada, recalculamos el análisis.</li>
              <li>Las alertas corregidas se marcan como «aclarada» o «retirada», con la razón y la fecha.</li>
            </ol>
          </div>
          <div className="card p-5">
            <h2 className="text-lg font-bold">Errores en la fuente oficial</h2>
            <p className="mt-2">Si el error está en el portal de la DGCP o de otra institución, también puedes comunicarlo a esa entidad: nosotros reflejamos lo que publican.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

async function FormWithParams({ searchParams }: { searchParams: PageProps<"/correcciones">["searchParams"] }) {
  const raw = flattenParams(await searchParams);
  return <CorrectionForm defaultRef={raw.ref?.slice(0, 300)} defaultType={raw.tipo?.slice(0, 20)} />;
}
