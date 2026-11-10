"use client";

import { useActionState } from "react";
import { submitCorrection, type CorrectionState } from "./actions";

const initial: CorrectionState = { ok: false, message: "" };

export function CorrectionForm({ defaultRef, defaultType }: { defaultRef?: string; defaultType?: string }) {
  const [state, action, pending] = useActionState(submitCorrection, initial);
  const err = state.errors ?? {};
  if (state.ok) {
    return (
      <div role="status" className="rounded-[var(--radius-card)] border border-green/40 bg-green-soft p-5 font-bold text-green">
        {state.message}
      </div>
    );
  }
  return (
    <form action={action} className="card space-y-5 p-5" noValidate>
      {state.message && (
        <p role="alert" className="font-bold text-red-text">
          {state.message}
        </p>
      )}
      <div>
        <label className="label" htmlFor="c-type">¿Sobre qué es tu solicitud?</label>
        <select id="c-type" name="entity_type" defaultValue={defaultType ?? "proceso"} className="field">
          <option value="proceso">Una compra o proceso</option>
          <option value="contrato">Un contrato</option>
          <option value="alerta">Una alerta del Radar</option>
          <option value="institucion">Una institución</option>
          <option value="proveedor">Un proveedor</option>
          <option value="obra">Una obra</option>
          <option value="otro">Otro tema o contacto general</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="c-ref">Código, enlace o nombre del registro</label>
        <input id="c-ref" name="entity_ref" defaultValue={defaultRef} className="field" aria-invalid={Boolean(err.entity_ref)} aria-describedby={err.entity_ref ? "e-ref" : undefined} />
        {err.entity_ref && <p id="e-ref" className="mt-1 font-bold text-red-text">{err.entity_ref}</p>}
      </div>
      <div>
        <label className="label" htmlFor="c-msg">¿Qué está mal o qué información aportas?</label>
        <textarea id="c-msg" name="message" rows={6} className="field" aria-invalid={Boolean(err.message)} aria-describedby={err.message ? "e-msg" : "h-msg"} />
        <p id="h-msg" className="mt-1 text-sm text-ink-muted">Si tienes un documento oficial que aclare el caso, indica dónde está publicado.</p>
        {err.message && <p id="e-msg" className="mt-1 font-bold text-red-text">{err.message}</p>}
      </div>
      <div>
        <label className="label" htmlFor="c-url">Enlace a un documento de respaldo (opcional)</label>
        <input id="c-url" name="evidence_url" type="url" inputMode="url" className="field" placeholder="https://" aria-invalid={Boolean(err.evidence_url)} aria-describedby={err.evidence_url ? "e-url" : undefined} />
        {err.evidence_url && <p id="e-url" className="mt-1 font-bold text-red-text">{err.evidence_url}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="c-name">Tu nombre (opcional)</label>
          <input id="c-name" name="requester_name" autoComplete="name" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="c-mail">Tu correo, si quieres respuesta (opcional)</label>
          <input id="c-mail" name="requester_email" type="email" autoComplete="email" className="field" aria-invalid={Boolean(err.requester_email)} aria-describedby={err.requester_email ? "e-mail" : undefined} />
          {err.requester_email && <p id="e-mail" className="mt-1 font-bold text-red-text">{err.requester_email}</p>}
        </div>
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="c-web">No llenes este campo</label>
        <input id="c-web" name="sitio_web" tabIndex={-1} autoComplete="off" />
      </div>
      <p className="text-sm text-ink-muted">Usamos tus datos solo para responder esta solicitud. No los publicamos.</p>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}
