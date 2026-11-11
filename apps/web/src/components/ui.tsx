import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Catalogos, MiembroEquipo } from "../lib/domain";
import { ApiError } from "../lib/api";
import { colorFor, alias } from "../lib/format";

/* ---------- Contexto de la app (catálogos, equipo, usuario, toast) ---------- */

export interface AppContextValue {
  catalogos: Catalogos;
  equipo: MiembroEquipo[];
  userId: string;
  toast: (message: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp fuera de AppContext");
  return ctx;
}

/** Mensaje legible para mostrar al usuario a partir de cualquier error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.serverMessage ?? `Error ${error.status}`;
  if (error instanceof Error) return error.message;
  return "Error inesperado";
}

export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [message, show];
}

/* ---------- Primitivas visuales ---------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay show" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function AbogadoTag({ email }: { email: string | null | undefined }) {
  if (!email) return null;
  return (
    <span className="abogado-tag" style={{ background: colorFor(email) }}>
      {alias(email)}
    </span>
  );
}

export function TipoBadge({ nombre, color }: { nombre: string | null; color: string | null }) {
  if (!nombre) return null;
  return (
    <span className="tipo-badge" style={{ background: color ?? "#6b6b66" }}>
      {nombre}
    </span>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="empty" role="status">
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      {errorMessage(error)}
      {onRetry && (
        <button type="button" className="btn-sm" onClick={onRetry} style={{ marginLeft: 8 }}>
          Reintentar
        </button>
      )}
    </div>
  );
}

/** Carga asíncrona simple con recarga manual. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((prev) => ({ data: prev.data, loading: true }));
    load().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
