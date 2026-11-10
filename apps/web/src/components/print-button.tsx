"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-5" /> Imprimir o guardar PDF
    </button>
  );
}
