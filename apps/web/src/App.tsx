import { useCallback, useEffect, useState } from "react";
import { Login } from "./components/Login";
import { ApiError, apiFetch, isDeactivatedError } from "./lib/api";
import { getSupabaseClient } from "./lib/supabase";

/** User payload returned by GET /api/auth/me (identidad + roles resueltos). */
export interface MeUser {
  id: string;
  email: string;
  role: string | null;
  roles: string[];
  estudioId: string;
}

type AuthScreenState =
  | { view: "loading" }
  | { view: "login"; notice?: string }
  | { view: "authenticated"; user: MeUser }
  | { view: "deactivated" }
  | { view: "api-error"; message: string };

export function App() {
  const [status, setStatus] = useState<AuthScreenState>({ view: "loading" });
  const [attempt, setAttempt] = useState(0);

  /**
   * Session gate: resolves the current Supabase session and, when present,
   * validates it end-to-end against the API via /api/auth/me.
   */
  const loadAuthenticated = useCallback(async () => {
    const client = getSupabaseClient();
    const { data } = await client.auth.getSession();

    if (!data.session) {
      setStatus({ view: "login" });
      return;
    }

    try {
      const payload = await apiFetch<{ user: MeUser }>("/api/auth/me");
      setStatus({ view: "authenticated", user: payload.user });
    } catch (error) {
      if (isDeactivatedError(error)) {
        setStatus({ view: "deactivated" });
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        // Session from storage but the API rejects it: force a clean state.
        await client.auth.signOut();
        setStatus({
          view: "login",
          notice: "Tu sesión expiró. Iniciá sesión nuevamente.",
        });
        return;
      }
      setStatus({
        view: "api-error",
        message:
          error instanceof Error
            ? error.message
            : "Error de conexión con la API.",
      });
    }
  }, []);

  useEffect(() => {
    void loadAuthenticated();
  }, [loadAuthenticated, attempt]);

  // React to sign-out events emitted by the Supabase client (local logout,
  // another tab logging out, or a revoked refresh token).
  useEffect(() => {
    const client = getSupabaseClient();
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setStatus({ view: "login" });
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = useCallback(async () => {
    const client = getSupabaseClient();
    await client.auth.signOut();
    setStatus({ view: "login" });
  }, []);

  const handleRetry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  if (status.view === "loading") {
    return (
      <main className="container">
        <div className="card">
          <p className="status" role="status">
            Cargando sesión…
          </p>
        </div>
      </main>
    );
  }

  if (status.view === "login") {
    return <Login notice={status.notice} onSuccess={handleRetry} />;
  }

  if (status.view === "deactivated") {
    return (
      <main className="container">
        <div className="card">
          <div className="alert alert--warn" role="alert">
            Tu cuenta está desactivada. Contactá al administrador del estudio.
          </div>
          <button className="button" type="button" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </main>
    );
  }

  if (status.view === "api-error") {
    return (
      <main className="container">
        <div className="card">
          <div className="alert alert--error" role="alert">
            {status.message}
          </div>
          <button className="button" type="button" onClick={handleRetry}>
            Reintentar
          </button>
          <button className="button button--ghost" type="button" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </main>
    );
  }

  const { user } = status;
  return (
    <main className="container">
      <div className="card">
        <h1 className="card__title">Sesión iniciada</h1>
        <p className="card__subtitle">SECHUB — Sistema de gestión</p>
        <p className="status-line">
          <strong>Correo:</strong> {user.email}
        </p>
        <p className="status-line">
          <strong>Roles:</strong>{" "}
          {user.roles.length > 0
            ? user.roles.map((role) => (
                <span key={role} className="badge">
                  {role}
                </span>
              ))
            : "Sin roles asignados"}
        </p>
        <button className="button" type="button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}
