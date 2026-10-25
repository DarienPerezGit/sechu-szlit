import { beforeEach, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { sectores, estadosCaso, carpetas, bitacoraCarpetas, type Database } from "@sechub/db";
import { buildApp } from "../src/app.js";
import {
  createTestDatabase,
  createTestSupabaseClient,
  resetDatabase,
  seedUser,
} from "./helpers/db.js";

describe("carpetas API", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
    // Cleanup any test carpetas/bitacora records
    await db.delete(bitacoraCarpetas);
    await db.delete(carpetas);
  });

  async function createApp() {
    return buildApp({
      db,
      environment: "test",
      supabase: createTestSupabaseClient(),
    });
  }

  async function loginUser(_app: any, userCredentials: { authHeader: string }) { return userCredentials.authHeader; }

  it("returns 401 when not authenticated for CRUD endpoints", async () => {
    const app = await createApp();

    const getRes = await app.inject({ method: "GET", url: "/api/carpetas" });
    expect(getRes.statusCode).toBe(401);

    const getOneRes = await app.inject({ method: "GET", url: "/api/carpetas/00000000-0000-0000-0000-000000000000" });
    expect(getOneRes.statusCode).toBe(401);

    const postRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      payload: {
        sectorActualId: 1,
        estadoCasoId: 1,
        expediente: "EXP-UNAUTH",
        caratula: "Unauth",
        demandada: "Unauth",
      },
    });
    expect(postRes.statusCode).toBe(401);

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/carpetas/00000000-0000-0000-0000-000000000000",
      payload: { version: 1, caratula: "Unauth" },
    });
    expect(patchRes.statusCode).toBe(401);
  });

  it("creates, lists, gets, and updates a carpeta using optimistic locking", async () => {
    const app = await createApp();
    const userCredentials = await seedUser(db);
    const cookie = await loginUser(app, userCredentials);

    // Retrieve active sector and state
    const [sector] = await db.select().from(sectores).where(eq(sectores.activo, true)).limit(1);
    const [estado] = await db.select().from(estadosCaso).where(eq(estadosCaso.activo, true)).limit(1);

    expect(sector).toBeDefined();
    expect(estado).toBeDefined();

    const expediente = `EXP-${Date.now()}`;

    // 1. Create Carpeta
    const postRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente,
        caratula: "Pérez c/ Szlit",
        demandada: "Szlit S.A.",
      },
    });

    expect(postRes.statusCode).toBe(201);
    const created = postRes.json();
    expect(created.id).toBeDefined();
    expect(created.version).toBe(1);
    expect(created.expediente).toBe(expediente);
    expect(created.caratula).toBe("Pérez c/ Szlit");

    // Verify bitacora entry was created in the database
    const dbBitacora = await db
      .select()
      .from(bitacoraCarpetas)
      .where(eq(bitacoraCarpetas.carpetaId, created.id));
    expect(dbBitacora).toHaveLength(1);
    expect(dbBitacora[0].accionRealizada).toBe("Carpeta creada manualmente");

    // 2. List Carpetas
    const listRes = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { authorization: cookie },
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    // 3. Get Single Carpeta
    const getOneRes = await app.inject({
      method: "GET",
      url: `/api/carpetas/${created.id}`,
      headers: { authorization: cookie },
    });
    expect(getOneRes.statusCode).toBe(200);
    expect(getOneRes.json().id).toBe(created.id);

    // 4. Update Carpeta with correct version (succeeds)
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${created.id}`,
      headers: { authorization: cookie },
      payload: {
        version: 1,
        caratula: "Pérez c/ Szlit S.R.L.",
        demandada: "Szlit S.R.L.",
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json();
    expect(updated.version).toBe(2);
    expect(updated.caratula).toBe("Pérez c/ Szlit S.R.L.");

    // Verify a second bitacora entry was created for update
    const dbBitacora2 = await db
      .select()
      .from(bitacoraCarpetas)
      .where(eq(bitacoraCarpetas.carpetaId, created.id));
    expect(dbBitacora2).toHaveLength(2);

    // 5. Update Carpeta with stale version (fails with 409 Conflict)
    const patchResStale = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${created.id}`,
      headers: { authorization: cookie },
      payload: {
        version: 1, // Stale version (current is 2)
        caratula: "Pérez c/ Szlit S.A.",
      },
    });
    expect(patchResStale.statusCode).toBe(409);
    expect(patchResStale.json().error).toBe("la carpeta cambió, recargá");

    // Verify version in DB is still 2
    const [finalCarpeta] = await db
      .select()
      .from(carpetas)
      .where(eq(carpetas.id, created.id))
      .limit(1);
    expect(finalCarpeta.version).toBe(2);
    expect(finalCarpeta.caratula).toBe("Pérez c/ Szlit S.R.L.");
  });
});
