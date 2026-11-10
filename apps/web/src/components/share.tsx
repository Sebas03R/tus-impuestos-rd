"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";

/** "Compartir esta compra": Web Share API en celulares; si no existe, copia el enlace. */
export function ShareButton({ title, text, label = "Compartir esta compra" }: { title: string; text: string; label?: string }) {
  const [status, setStatus] = useState("");
  async function onShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setStatus("");
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Enlace copiado.");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setStatus("No se pudo compartir. Copia la dirección desde el navegador.");
    }
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={onShare} className="btn btn-secondary">
        <Share2 aria-hidden="true" className="size-5" /> {label}
      </button>
      <span role="status" aria-live="polite" className="min-h-6 text-sm font-bold text-green">
        {status}
      </span>
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className="btn btn-quiet"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check aria-hidden="true" className="size-5" /> : <Copy aria-hidden="true" className="size-5" />}
        {label}
      </button>
      <span role="status" aria-live="polite" className="min-h-6 text-sm font-bold text-green">
        {copied ? "Copiado." : ""}
      </span>
    </span>
  );
}
