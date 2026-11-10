import { MAP_VIEWBOX, PROVINCES } from "@/lib/geo/provinces";
import { formatNumber } from "@/lib/format";

/** Normaliza nombres de provincia entre fuentes (geoBoundaries vs. MapaInversiones). */
export function provinceKey(name: string | null | undefined): string {
  const base = (name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/^PROVINCIA\s+(DE\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim();
  const aliases: Record<string, string> = {
    HERMANAS: "HERMANAS MIRABAL",
    "LA ESTRELLETA": "ELIAS PINA",
    "EL SEYBO": "EL SEIBO",
    BAHORUCO: "BAORUCO",
    "MONTE CRISTI": "MONTECRISTI",
    "SANTIAGO DE LOS CABALLEROS": "SANTIAGO",
    "SAN PEDRO DE MACORIS": "SAN PEDRO DE MACORIS",
  };
  return aliases[base] ?? base;
}

const STEPS = ["#EAF3FA", "#C8D9EA", "#8FB0D1", "#4F7AA8", "#12345A"];

/**
 * Mapa coroplético por provincia: cantidad de proyectos con ubicación provincial publicada.
 * Alternativa visual a la lista; nunca ubica obras en puntos inventados.
 */
export function ProvinceMap({
  counts,
  selected,
  hrefFor,
}: {
  counts: { province: string; n: number }[];
  selected?: string;
  hrefFor: (province: string) => string;
}) {
  const byKey = new Map<string, { province: string; n: number }>();
  for (const c of counts) {
    const k = provinceKey(c.province);
    const prev = byKey.get(k);
    byKey.set(k, { province: c.province, n: (prev?.n ?? 0) + c.n });
  }
  const max = Math.max(1, ...[...byKey.values()].map((v) => v.n));
  const k = STEPS.length;
  const step = (n: number) => (n <= 0 ? -1 : Math.min(k - 1, Math.ceil((n * k) / max) - 1));
  const buckets = STEPS.map((color, i) => ({ color, from: Math.floor((max * i) / k) + 1, to: Math.floor((max * (i + 1)) / k) })).filter((b) => b.from <= b.to);
  const selKey = selected ? provinceKey(selected) : null;

  return (
    <figure>
      <svg viewBox={MAP_VIEWBOX} className="h-auto w-full" role="img" aria-labelledby="mapa-titulo mapa-desc">
        <title id="mapa-titulo">Mapa de proyectos de inversión por provincia</title>
        <desc id="mapa-desc">Cada provincia se colorea según la cantidad de proyectos con ubicación provincial publicada. La lista de provincias debajo contiene los mismos datos.</desc>
        {PROVINCES.map((p) => {
          const data = byKey.get(provinceKey(p.name));
          const n = data?.n ?? 0;
          const s = step(n);
          const isSel = selKey === provinceKey(p.name);
          const label = `${p.name}: ${formatNumber(n)} proyectos`;
          const shape = (
            <path
              d={p.d}
              fill={s < 0 ? "#FFFFFF" : STEPS[s]}
              stroke={isSel ? "#D92732" : "#8A99AD"}
              strokeWidth={isSel ? 3 : 1}
              vectorEffect="non-scaling-stroke"
            >
              <title>{label}</title>
            </path>
          );
          return data ? (
            <a key={p.iso} href={hrefFor(data.province)} aria-label={label}>
              {shape}
            </a>
          ) : (
            <g key={p.iso}>{shape}</g>
          );
        })}
      </svg>
      <figcaption className="mt-3 text-sm text-ink-muted">
        <span className="font-bold text-ink">Proyectos por provincia.</span> Los proyectos de alcance nacional no aparecen en el mapa.
        Límites provinciales: geoBoundaries (Natural Earth, dominio público).
      </figcaption>
      <ul className="mt-2 flex flex-wrap items-center gap-3 text-sm" aria-label="Leyenda">
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-4 rounded-sm border border-[#8A99AD] bg-white" /> Sin proyectos</li>
        {buckets.map((b) => (
          <li key={b.color} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-4 rounded-sm border border-[#8A99AD]" style={{ background: b.color }} />
            {b.from === b.to ? formatNumber(b.from) : `${formatNumber(b.from)}–${formatNumber(b.to)}`}
          </li>
        ))}
      </ul>
    </figure>
  );
}
