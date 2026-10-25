import { useState, type FormEvent } from "react";
import { getSupabaseClient } from "../lib/supabase";

const KNOWN_AUTH_ERROR_MESSAGES = new Map<string, string>([
  ["Invalid login credentials", "Correo o contraseña incorrectos."],
  [
    "Email not confirmed",
    "Tu cuenta aún no fue confirmada. Revisá tu casilla de correo.",
  ],
]);

function describeAuthError(message: string): string {
  return (
    KNOWN_AUTH_ERROR_MESSAGES.get(message) ??
    "No se pudo iniciar sesión. Intentá nuevamente."
  );
}

export interface LoginProps {
  /** Notice rendered above the form, e.g. expired-session notice. */
  notice?: string;
  onSuccess: () => void;
}

export function Login({ notice, onSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const client = getSupabaseClient();
      const { error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) {
        setError(describeAuthError(authError.message));
        return;
      }
      onSuccess();
    } catch {
      setError(
        "Error de conexión con el servicio de autenticación. Intentá nuevamente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <h1 className="card__title">Iniciar sesión</h1>
        <p className="card__subtitle">SECHUB — Sistema de gestión</p>
        {notice ? <div className="alert alert--info">{notice}</div> : null}
        <form onSubmit={handleSubmit}>
          <label className="field">
            Correo electrónico
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
              disabled={submitting}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            Contraseña
            <input
              type="password"
              value={password}
              required
              autoComplete="current-password"
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}
