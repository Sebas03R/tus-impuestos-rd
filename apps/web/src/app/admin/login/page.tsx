import { LoginForm } from "../forms";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="container-page max-w-md py-16">
      <h1 className="mb-2 text-2xl font-extrabold">Panel de administración</h1>
      <p className="mb-6 text-ink-muted">Acceso restringido al equipo del proyecto. El procesamiento automático no depende de este panel.</p>
      <LoginForm />
    </div>
  );
}
