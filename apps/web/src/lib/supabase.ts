import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "./config";

let client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase browser client, creating it on first use.
 *
 * persistSession and autoRefreshToken are the library defaults and are kept
 * explicit on purpose: session persistence and background access-token
 * refresh are required behavior for this app.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const config = loadConfig();
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

/**
 * Test seam: replaces (or clears) the singleton instance. Pass `null` to
 * force the next `getSupabaseClient()` call to rebuild from config.
 */
export function setSupabaseClient(value: SupabaseClient | null): void {
  client = value;
}
