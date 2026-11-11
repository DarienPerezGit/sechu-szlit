import { useMemo, useState } from "react";
import type { MeUser } from "../App";
import { fetchCatalogos, fetchEquipo } from "../lib/domain";
import { ActasView } from "../views/ActasView";
import { CalendarioView } from "../views/CalendarioView";
import { CarpetasView } from "../views/CarpetasView";
import { AppContext, ErrorBox, Loading, useAsync, useToast } from "./ui";

const TABS = [
  { id: "carpetas", label: "📁 Carpetas" },
  { id: "calendario", label: "📅 Calendario" },
  { id: "actas", label: "📋 Actas" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function Shell({ user, onLogout }: { user: MeUser; onLogout: () => void }) {
  const [tab, setTab] = useState<TabId>("carpetas");
  const [toastMessage, toast] = useToast();
  const base = useAsync(() => Promise.all([fetchCatalogos(), fetchEquipo()]), []);

  const ctx = useMemo(
    () => (base.data ? { catalogos: base.data[0], equipo: base.data[1], userId: user.id, toast } : null),
    [base.data, user.id, toast],
  );

  return (
    <div className="app-wrap">
      <header className="header">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            ⚖️
          </div>
          <div>
            <h1>SECHUB · Estudio Szlit</h1>
            <p>
              {user.email}{" "}
              {user.roles.map((role) => (
                <span key={role} className="badge info">
                  {role}
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="user-bar">
          <button type="button" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {base.error ? <ErrorBox error={base.error} onRetry={base.reload} /> : null}
      {!ctx && !base.error && <Loading />}
      {ctx && (
        <AppContext.Provider value={ctx}>
          {tab === "carpetas" && <CarpetasView />}
          {tab === "calendario" && <CalendarioView />}
          {tab === "actas" && <ActasView />}
        </AppContext.Provider>
      )}

      {toastMessage && (
        <div className="toast show" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
