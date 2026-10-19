import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config";

const VITE_VARS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

type EnvBag = Record<string, string | undefined>;
let envBackup: EnvBag = {};

function getEnvBag(): EnvBag {
  return import.meta.env as unknown as EnvBag;
}

function setEnvVars(values: Partial<Record<string, string>>): void {
  const bag = getEnvBag();
  for (const [key, value] of Object.entries(values)) bag[key] = value;
}

function clearViteEnvVars(): void {
  const bag = getEnvBag();
  for (const key of VITE_VARS) delete bag[key];
}

beforeEach(() => {
  envBackup = {};
  for (const key of VITE_VARS) envBackup[key] = getEnvBag()[key];
  clearViteEnvVars();
});

afterEach(() => {
  setEnvVars(envBackup);
  vi.restoreAllMocks();
});

describe("loadConfig", () => {
  it("throws and logs a clear error when both required vars are missing", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => loadConfig()).toThrowError(/VITE_SUPABASE_URL/);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("throws when only the publishable key is missing", () => {
    setEnvVars({
      VITE_SUPABASE_URL: "https://example.supabase.co",
    });

    expect(() => loadConfig()).toThrowError(
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("loads configuration from Vite env vars", () => {
    setEnvVars({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });

    expect(loadConfig()).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("gives injected overrides precedence over env vars", () => {
    setEnvVars({
      VITE_SUPABASE_URL: "https://env-fallback.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_env",
    });

    const config = loadConfig({
      supabaseUrl: "https://runtime-injected.supabase.co",
    });
    expect(config.supabaseUrl).toBe("https://runtime-injected.supabase.co");
    expect(config.supabasePublishableKey).toBe("sb_publishable_env");
  });
});
