import { useCallback, useEffect, useRef, useState } from "react";
import { Login } from "./components/Login";
import { Shell } from "./components/Shell";
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
  const userInitiatedSignOut = useRef(false);

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

  // React to sign-out events emitted by the Supabase client. The library has
  // no dedicated refresh-failure event: when a background token refresh fails
  // it removes the dead session and emits `SIGNED_OUT`. A sign-out we did not
  // initiate therefore means the session expired underneath us (failed
  // refresh, revoked token, or logout in another tab), so the expired-session
  // notice is shown; a user-driven logout stays on the plain login view.
  useEffect(() => {
    const client = getSupabaseClient();
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") {
        return;
      }
      if (userInitiatedSignOut.current) {
        setStatus({ view: "login" });
        return;
      }
      setStatus({
        view: "login",
        notice: "Tu sesión expiró. Iniciá sesión nuevamente.",
      });
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = useCallback(async () => {
    const client = getSupabaseClient();
    userInitiatedSignOut.current = true;
    await client.auth.signOut();
    userInitiatedSignOut.current = false;
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

  return <Shell user={status.user} onLogout={handleLogout} />;
}
