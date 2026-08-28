import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { usuarios } from "@sechub/db";
import { buildApp } from "../src/app.js";
import {
  createTestDatabase,
  resetDatabase,
  seedUser,
} from "./helpers/db.js";

describe("authentication API", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function createApp() {
    return buildApp({
      db,
      cookieSecret: "test-secret",
      environment: "test",
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

  it("returns 401 for GET /api/auth/me without a session cookie", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toHaveProperty("error");
  });

  it("returns a session cookie with httpOnly and SameSite=Strict on successful login", async () => {
    const app = await createApp();
    const { email, password } = await seedUser(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.email).toBe(email);
    expect(body.user).toHaveProperty("estudioId");

    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("sessionId=");
  });

  it("returns 401 for login with invalid password", async () => {
    const app = await createApp();
    const { email } = await seedUser(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "wrong-password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toHaveProperty("error");
  });

  it("returns 401 for login with unknown email", async () => {
    const app = await createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "unknown@estudioszlit.com.ar",
        password: "any-password",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("exposes the normalized role from /api/auth/me instead of the legacy scalar", async () => {
    const app = await createApp();
    const { email, password } = await seedUser(db, {
      email: `normalized-role-${Date.now()}@test.com`,
    });
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

    await db
      .update(usuarios)
      .set({ role: "lectura" })
      .where(eq(usuarios.id, user.id));

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    const cookie = loginResponse.headers["set-cookie"];
    expect(cookie).toBeDefined();

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.role).toBe("admin");
    expect(meResponse.json().user.roles).toEqual(["admin"]);
  });

  it("persists the session across subsequent requests", async () => {
    const app = await createApp();
    const { email, password } = await seedUser(db);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });

    const cookie = loginResponse.headers["set-cookie"];
    expect(cookie).toBeDefined();

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.email).toBe(email);
  });

  it("invalidates the session on logout", async () => {
    const app = await createApp();
    const { email, password } = await seedUser(db);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });

    const cookie = loginResponse.headers["set-cookie"];
    expect(cookie).toBeDefined();

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie,
      },
    });

    expect(logoutResponse.statusCode).toBe(200);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: Array.isArray(cookie) ? cookie.join("; ") : cookie,
      },
    });

    expect(meResponse.statusCode).toBe(401);
  });

  it("stores passwords hashed with argon2, never in plain text", async () => {
    const { email, password } = await seedUser(db);

    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

    expect(user.passwordHash).not.toBe(password);
    expect(user.passwordHash).toContain("$argon2");
  });
});
