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

type ViteEnv = Record<string, string | undefined>;

function readViteEnv(name: string): string | undefined {
  const importMeta = import.meta as { env?: ViteEnv };
  return importMeta.env?.[name];
}

function readValues(overrides: Partial<WebConfig>): {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
} {
  return {
    supabaseUrl: overrides.supabaseUrl ?? readViteEnv("VITE_SUPABASE_URL"),
    supabasePublishableKey:
      overrides.supabasePublishableKey ??
      readViteEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
  };
}

/**
 * Loads the web config from Vite env vars (VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY), failing fast with a clear message if any is
 * missing.
 *
 * `overrides` is the entry point for runtime-injected configuration (intended
 * for the deployment step in a follow-up issue): whichever field is provided
 * explicitly wins over the env var.
 */
export function loadConfig(overrides: Partial<WebConfig> = {}): WebConfig {
  const { supabaseUrl, supabasePublishableKey } = readValues(overrides);

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
