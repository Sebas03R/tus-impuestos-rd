"use client";

import { useActionState } from "react";
import { changeAlertStatus, createRuleVersion, login, triggerSync, updateCorrection, type ActionState } from "./actions";

const initial: ActionState = { ok: false, message: "" };

function Status({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`mt-2 font-bold ${state.ok ? "text-green" : "text-red-text"}`}>
      {state.message}
    </p>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);
  return (
    <form action={action} className="card space-y-4 p-6">
      <div>
        <label className="label" htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="field" />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Verificando…" : "Entrar"}</button>
      <Status state={state} />
    </form>
  );
}

export function AlertStatusForm({ alertId, status, label }: { alertId: string; status: string; label: string }) {
  const [state, action, pending] = useActionState(changeAlertStatus, initial);
  return (
    <form action={action} className="mt-3 grid gap-2 md:grid-cols-[auto_auto_1fr_auto] md:items-end">
      <input type="hidden" name="alert_id" value={alertId} />
      <div>
        <label className="label text-sm" htmlFor={`s-${alertId}`}>Estado</label>
        <select id={`s-${alertId}`} name="status" defaultValue={status} className="field">
          {["publicada", "interna", "en_revision", "retirada", "aclarada"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-sm" htmlFor={`l-${alertId}`}>Etiqueta pública</label>
        <select id={`l-${alertId}`} name="label" defaultValue={label} className="field">
          {["revision_sugerida", "revision_prioritaria", "informacion_insuficiente", "aclarada", "sin_alerta_vigente"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-sm" htmlFor={`r-${alertId}`}>Motivo (queda en el historial público)</label>
        <input id={`r-${alertId}`} name="reason" required minLength={10} className="field" />
      </div>
      <button className="btn btn-secondary" disabled={pending}>Guardar</button>
      <div className="md:col-span-4"><Status state={state} /></div>
    </form>
  );
}

export function RuleForm({ code, params }: { code: string; params: string }) {
  const [state, action, pending] = useActionState(createRuleVersion, initial);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="code" value={code} />
      <label className="label text-sm" htmlFor={`p-${code}`}>Parámetros (JSON)</label>
      <textarea id={`p-${code}`} name="params" defaultValue={params} rows={8} className="field font-mono text-sm" spellCheck={false} />
      <label className="label text-sm" htmlFor={`n-${code}`}>Nota del cambio</label>
      <input id={`n-${code}`} name="note" required minLength={10} className="field" />
      <button className="btn btn-secondary" disabled={pending}>Crear nueva versión</button>
      <Status state={state} />
    </form>
  );
}

export function CorrectionUpdateForm({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState(updateCorrection, initial);
  return (
    <form action={action} className="mt-3 grid gap-2 md:grid-cols-[auto_1fr_auto] md:items-end">
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="label text-sm" htmlFor={`cs-${id}`}>Estado</label>
        <select id={`cs-${id}`} name="status" defaultValue={status} className="field">
          {["recibida", "en_revision", "aceptada", "rechazada"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-sm" htmlFor={`cr-${id}`}>Resolución</label>
        <input id={`cr-${id}`} name="resolution" className="field" />
      </div>
      <button className="btn btn-secondary" disabled={pending}>Guardar</button>
      <div className="md:col-span-3"><Status state={state} /></div>
    </form>
  );
}

export function SyncForm() {
  const [state, action, pending] = useActionState(triggerSync, initial);
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div>
        <label className="label text-sm" htmlFor="wf">Flujo</label>
        <select id="wf" name="workflow" className="field">
          <option value="sync-dgcp.yml">Compras (DGCP)</option>
          <option value="sync-secundarias.yml">Presupuesto, obras y tasas</option>
        </select>
      </div>
      <button className="btn btn-primary" disabled={pending}>Ejecutar ahora</button>
      <Status state={state} />
    </form>
  );
}
