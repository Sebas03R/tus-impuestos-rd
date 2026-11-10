"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page py-16" role="alert">
      <h1 className="text-[2rem] font-extrabold">Algo falló al mostrar esta página</h1>
      <p className="mt-3 max-w-2xl text-ink-muted">
        No mostramos cifras incompletas. Puedes intentar de nuevo; si el problema sigue, la fuente o nuestra base pueden estar en mantenimiento.
      </p>
      <button type="button" onClick={() => reset()} className="btn btn-primary mt-6">
        Intentar de nuevo
      </button>
    </div>
  );
}
