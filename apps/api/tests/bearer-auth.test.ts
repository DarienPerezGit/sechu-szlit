import { describe, expect, it, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLE_CODES, carpetas, roles, type Database } from "@sechub/db";
import { buildApp } from "../src/app.js";
import { createTestDatabase, resetDatabase, seedUser } from "./helpers/db.js";

/** Creates a mock SupabaseClient that stubs auth.getUser. */
function createMockSupabase(handler: (token: string) => Promise<{ data: { user: { id: string } | null }; error: Error | null }>): SupabaseClient {
  return {
    auth: {
      getUser: async (token: string) => handler(token),
    },
  } as unknown as SupabaseClient;
}

describe("Issue #29: Bearer Supabase authentication & dynamic authorization", async () => {
  const db: Database = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function createApp(supabase: SupabaseClient | null = null) {
    return buildApp({
      db,
      cookieSecret: "test-secret-32-chars-long-minimum!",
      environment: "test",
      supabase,
    });
  }

  // -------------------------------------------------------------------------
  // Criteria 1 & 2: Token validation & safe rejection of malformed/invalid
  // -------------------------------------------------------------------------

  it("rejects request when Bearer token is missing", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "No autenticado" });
  });

  it("rejects malformed Authorization header safely", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Token inválido o expirado" });
  });

  it("rejects empty Bearer token", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Bearer   " },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Token inválido o expirado" });
  });

  it("rejects request if Bearer auth is used but Supabase is not configured", async () => {
    const app = await createApp(null); // No Supabase client
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Bearer some-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Autenticación Supabase no configurada" });
  });

  it("rejects invalid or expired token returned by Supabase", async () => {
    const mockSupabase = createMockSupabase(async () => ({
      data: { user: null },
      error: new Error("JWT expired"),
    }));

    const app = await createApp(mockSupabase);
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Bearer expired-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Token inválido o expirado" });
  });

  // -------------------------------------------------------------------------
  // Criteria 3 & 4: Identity resolution & inactive/missing profile rejection
  // -------------------------------------------------------------------------

  it("rejects authenticated Supabase user who has no internal profile", async () => {
    const foreignUid = "00000000-0000-0000-0000-000000000099";
    const mockSupabase = createMockSupabase(async () => ({
      data: { user: { id: foreignUid } },
      error: null,
    }));

    const app = await createApp(mockSupabase);
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Perfil interno no encontrado" });
  });

  it("rejects authenticated Supabase user whose internal profile is inactive (activo = false)", async () => {
    const supabaseUid = "00000000-0000-0000-0000-000000000002";
    await seedUser(db, {
      email: "inactive@sechub.test",
      supabaseUserId: supabaseUid,
      activo: false,
    });

    const mockSupabase = createMockSupabase(async () => ({
      data: { user: { id: supabaseUid } },
      error: null,
    }));

    const app = await createApp(mockSupabase);
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Cuenta desactivada" });
  });

  it("authenticates and resolves internal profile via valid Bearer token", async () => {
    const supabaseUid = "00000000-0000-0000-0000-000000000001";
    const { user } = await seedUser(db, {
      email: "active@sechub.test",
      supabaseUserId: supabaseUid,
      activo: true,
      role: ROLE_CODES.ADMIN,
    });

    const mockSupabase = createMockSupabase(async (token) => {
      if (token === "valid-supabase-token") {
        return { data: { user: { id: supabaseUid } }, error: null };
      }
      return { data: { user: null }, error: new Error("invalid") };
    });

    const app = await createApp(mockSupabase);
    const response = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: "Bearer valid-supabase-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Criteria 5 & 8: Dynamic roles loaded from DB on every request
  // -------------------------------------------------------------------------

  it("reflects role and authorization changes immediately on the next request", async () => {
    const supabaseUid = "00000000-0000-0000-0000-000000000005";
    const { user } = await seedUser(db, {
      email: "dynamic@sechub.test",
      supabaseUserId: supabaseUid,
      activo: true,
      role: ROLE_CODES.LECTURA, // Read-only initially
    });

    const mockSupabase = createMockSupabase(async () => ({
      data: { user: { id: supabaseUid } },
      error: null,
    }));

    const app = await createApp(mockSupabase);
    const headers = { authorization: "Bearer valid-dynamic-token" };

    // Request 1: Attempt write operation (POST /carpetas) as LECTURA -> 403 Forbidden
    const createPayload = {
      sectorActualId: 1,
      estadoCasoId: 1,
      expediente: "EXP-DYN-01",
      caratula: "Perez c/ Empresa",
      demandada: "Empresa S.A.",
    };

    const firstRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers,
      payload: createPayload,
    });
    expect(firstRes.statusCode).toBe(403);
    expect(firstRes.json()).toEqual({ error: "No autorizado" });

    // Promote user dynamically in PostgreSQL: replace LECTURA with ADMIN in usuarios_roles
    await db.execute(sql`
      DELETE FROM usuarios_roles WHERE usuario_id = ${user.id}
    `);
    await db.execute(sql`
      INSERT INTO usuarios_roles (usuario_id, rol_id)
      SELECT ${user.id}, roles.id FROM roles WHERE codigo = ${ROLE_CODES.ADMIN}
    `);

    // Request 2: Exactly the same request, next turn -> 201 Created (no server restart)
    const secondRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers,
      payload: createPayload,
    });
    expect(secondRes.statusCode).toBe(201);
    expect(secondRes.json().expediente).toBe("EXP-DYN-01");
  });

  // -------------------------------------------------------------------------
  // Criteria 6 & 7: Audit rules and local cookie backward compatibility
  // -------------------------------------------------------------------------

  it("GET /api/auth/me resolves identity and roles via Bearer token", async () => {
    const supabaseUid = "00000000-0000-0000-0000-000000000010";
    const { user } = await seedUser(db, {
      email: "me@sechub.test",
      supabaseUserId: supabaseUid,
      activo: true,
      role: ROLE_CODES.RESPONSABLE_SECTOR,
    });

    const mockSupabase = createMockSupabase(async () => ({
      data: { user: { id: supabaseUid } },
      error: null,
    }));

    const app = await createApp(mockSupabase);
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer token-me" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.id).toBe(user.id);
    expect(body.user.email).toBe("me@sechub.test");
    expect(body.user.roles).toContain(ROLE_CODES.RESPONSABLE_SECTOR);
  });
});
