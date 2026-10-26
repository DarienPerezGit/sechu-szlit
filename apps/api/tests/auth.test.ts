import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { roles, usuarios, usuariosRoles } from "@sechub/db";
import { buildApp } from "../src/app.js";
import {
  createTestDatabase,
  createTestSupabaseClient,
  resetDatabase,
  seedUser,
} from "./helpers/db.js";

describe("authentication API (post-cutover Bearer-only)", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function createApp() {
    return buildApp({
      db,
      environment: "test",
      supabase: createTestSupabaseClient(),
    });
  }

  it("serves the static frontend placeholder from the root path", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.payload).toContain("SECHUB");
  });

  it("returns 401 for GET /api/auth/me without a Bearer token", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "No autenticado" });
  });

  it("rejects legacy local session cookies on GET /api/auth/me and protected routes", async () => {
    const app = await createApp();
    await seedUser(db);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: "sessionId=00000000-0000-7000-8000-000000000001.fakesignature",
      },
    });
    expect(meRes.statusCode).toBe(401);

    const carpetasRes = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: {
        cookie: "sessionId=00000000-0000-7000-8000-000000000001.fakesignature",
      },
    });
    expect(carpetasRes.statusCode).toBe(401);
  });

  it("removes POST /api/auth/login and POST /api/auth/logout endpoints", async () => {
    const app = await createApp();
    const { email, password } = await seedUser(db);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    expect(loginResponse.statusCode).toBe(404);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    expect(logoutResponse.statusCode).toBe(404);
  });

  it("exposes the normalized role from /api/auth/me via Bearer token", async () => {
    const app = await createApp();
    const { email, authHeader } = await seedUser(db, {
      email: `normalized-role-${Date.now()}@test.com`,
    });
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

    await db.delete(usuariosRoles).where(eq(usuariosRoles.usuarioId, user.id));
    const [lecturaRole] = await db.select().from(roles).where(eq(roles.codigo, "lectura")).limit(1);
    await db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: lecturaRole.id });

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        authorization: authHeader,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.role).toBe("lectura");
    expect(meResponse.json().user.roles).toEqual(["lectura"]);
  });
});
