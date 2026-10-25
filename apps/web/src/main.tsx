import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { getSupabaseClient } from "./lib/supabase";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// Fail fast when required VITE_SUPABASE_* configuration is missing so the
// failure is obvious, not a broken app after page load.
let configError: unknown = null;
try {
  getSupabaseClient();
} catch (error) {
  configError = error;
}

if (configError) {
  rootElement.innerHTML = `
    <main class="container">
      <div class="card">
        <div class="alert alert--error" role="alert">
          Error de configuración: faltan las variables
          VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY.
          Consultá apps/web/.env.example.
        </div>
      </div>
    </main>`;
  console.error(configError);
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
