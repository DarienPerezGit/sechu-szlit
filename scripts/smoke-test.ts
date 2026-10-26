import { createClient } from "@supabase/supabase-js";

interface SmokeConfig {
  baseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  testEmail: string;
  testPassword: string;
}

function loadConfig(): SmokeConfig {
  const baseUrl = (process.env.TARGET_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const formattedBaseUrl = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

  const testEmail = process.env.SMOKE_TEST_EMAIL ?? "admin@sechub.test";
  const testPassword = process.env.SMOKE_TEST_PASSWORD ?? "DevOnly-Admin-2024!";

  return {
    baseUrl: formattedBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    testEmail,
    testPassword,
  };
}

async function runSmokeTests() {
  const config = loadConfig();
  console.log(`[smoke-test] Target URL: ${config.baseUrl}`);
  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  // 1. Health check
  await check("Health endpoint (/api/health) returns 200 ok", async () => {
    const res = await fetch(`${config.baseUrl}/api/health`);
    if (!res.ok) throw new Error(`Unexpected status ${res.status}: ${await res.text()}`);
    const data = await res.json() as { status?: string };
    if (data.status !== "ok") throw new Error(`Expected status: ok, got: ${JSON.stringify(data)}`);
  });

  // 2. Unauthenticated rejection
  await check("Unauthenticated /api/auth/me returns 401", async () => {
    const res = await fetch(`${config.baseUrl}/api/auth/me`);
    if (res.status !== 401) throw new Error(`Expected 401, got: ${res.status}`);
  });

  // 3. Invalid token rejection
  await check("Invalid Bearer token returns 401", async () => {
    const res = await fetch(`${config.baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer invalid-token-12345" },
    });
    if (res.status !== 401) throw new Error(`Expected 401, got: ${res.status}`);
  });

  // 4. Authenticated flow (when Supabase credentials are provided)
  if (config.supabaseUrl && config.supabaseAnonKey) {
    console.log(`[smoke-test] Authenticating against Supabase: ${config.supabaseUrl}`);
    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

    let token: string | null = null;
    await check("Supabase sign-in with fictional presentation credentials", async () => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: config.testEmail,
        password: config.testPassword,
      });
      if (error) throw new Error(`Auth failed: ${error.message}`);
      if (!data.session?.access_token) throw new Error("No access_token returned");
      token = data.session.access_token;
    });

    if (token) {
      await check("Authenticated /api/auth/me returns 200 with user profile", async () => {
        const res = await fetch(`${config.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
        const user = await res.json() as { email?: string; roles?: string[] };
        if (user.email !== config.testEmail) throw new Error(`Expected email ${config.testEmail}, got ${user.email}`);
      });

      await check("Authenticated /api/catalogos returns active catalog data", async () => {
        const res = await fetch(`${config.baseUrl}/api/catalogos`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
        const catalogos = await res.json() as { estadosCaso?: unknown[]; tiposAudiencia?: unknown[] };
        if (!Array.isArray(catalogos.estadosCaso) || catalogos.estadosCaso.length === 0) {
          throw new Error("Expected non-empty estadosCaso catalog");
        }
      });
    }
  } else {
    console.log("[smoke-test] Skipping live Supabase sign-in (SUPABASE_URL or anon key not provided in env)");
  }

  console.log(`\n[smoke-test] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runSmokeTests().catch((err) => {
  console.error("[smoke-test] Fatal error:", err);
  process.exit(1);
});
