import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page py-16">
      <p className="eyebrow">Error 404</p>
      <h1 className="mt-2 text-[2rem] font-extrabold">No encontramos esta página</h1>
      <p className="mt-3 max-w-2xl text-ink-muted">
        Puede que el enlace esté incompleto o que el registro no exista en nuestra base (sincronizamos datos desde enero de 2025).
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/buscar" className="btn btn-primary">Buscar</Link>
        <Link href="/" className="btn btn-secondary">Ir al inicio</Link>
      </div>
    </div>
  );
}
