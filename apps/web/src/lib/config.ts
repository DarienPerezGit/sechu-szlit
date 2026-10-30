/**
 * Frontend configuration for the SECHUB web app.
 *
 * Only publishable/anon values belong here: the Supabase publishable key is
 * designed to be exposed in the browser bundle. No service_role/admin key
 * must ever be referenced in this file.
 */

export interface WebConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

/**
 * Loads the web config from Vite env vars (VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY), failing fast with a clear message if any is
 * missing.
 */
export function loadConfig(): WebConfig {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabasePublishableKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");

  if (missing.length > 0) {
    const message =
      `[sechub-web] Missing required configuration: ${missing.join(", ")}. ` +
      "Copy apps/web/.env.example to apps/web/.env.local and set the values " +
      "for the Supabase project, then restart the dev server.";
    console.error(message);
    throw new Error(message);
  }

  return {
    supabaseUrl: supabaseUrl as string,
    supabasePublishableKey: supabasePublishableKey as string,
  };
}
