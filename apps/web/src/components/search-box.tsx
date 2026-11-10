import { Search } from "lucide-react";

export function SearchBox({
  defaultValue,
  size = "lg",
  hidden,
}: {
  defaultValue?: string;
  size?: "lg" | "md";
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action="/buscar" method="get" role="search" className="w-full">
      <label htmlFor="q" className={`label ${size === "lg" ? "text-xl" : ""}`}>
        ¿Qué quieres buscar?
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-muted" />
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={defaultValue}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={200}
            aria-describedby="q-ayuda"
            className={`field pl-11 ${size === "lg" ? "min-h-14 text-lg" : ""}`}
          />
        </div>
        {hidden &&
          Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <button type="submit" className={`btn btn-primary ${size === "lg" ? "min-h-14 px-7 text-lg" : ""}`}>
          Buscar
        </button>
      </div>
      <p id="q-ayuda" className="mt-2 text-sm text-ink-muted">
        Escribe un producto, una institución, una empresa, un RNC o el código de un proceso.
      </p>
    </form>
  );
}
