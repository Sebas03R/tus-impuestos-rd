"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Búsqueda en lenguaje natural (solo visible si la IA está activada en el servidor). */
export function AskBox() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { url: string };
      router.push(data.url);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }
  return (
    <form onSubmit={onSubmit} className="rounded-[var(--radius-card)] border-2 border-ink bg-sky p-4">
      <label htmlFor="ask" className="label flex items-center gap-2">
        <Sparkles aria-hidden="true" className="size-5" /> Pregunta con tus palabras
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="ask" value={question} onChange={(e) => setQuestion(e.target.value)} className="field" maxLength={500} placeholder="¿Qué instituciones compraron vehículos este año?" />
        <button type="submit" className="btn btn-secondary" disabled={status === "loading" || question.trim().length < 3}>
          {status === "loading" ? "Pensando…" : "Preguntar"}
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-muted" role="status" aria-live="polite">
        {status === "error"
          ? "No pudimos interpretar la pregunta. Usa el buscador normal."
          : "Un asistente de IA convierte tu pregunta en filtros. Las cifras siempre salen de los datos oficiales."}
      </p>
    </form>
  );
}
