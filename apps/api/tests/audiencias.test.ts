import { beforeEach, describe, expect, it } from "vitest";
import { eq, and, isNull } from "drizzle-orm";
import {
  estudios,
  sectores,
  estadosCaso,
  usuarios,
  carpetas,
  bitacoraCarpetas,
  tiposAudiencia,
  audiencias,
  type Database,
} from "@sechub/db";
import { buildApp } from "../src/app.js";
import {
  createTestDatabase,
  resetDatabase,
  seedUser,
} from "./helpers/db.js";

describe("audiencias API", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
    // Cleanup any test audiencias/bitacora records
    await db.delete(audiencias);
    await db.delete(bitacoraCarpetas);
    await db.delete(carpetas);
  });

  async function createApp() {
    return buildApp({
      db,
      cookieSecret: "test-secret",
      environment: "test",
    });
  }

  async function loginUser(app: any, userCredentials: any) {
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: userCredentials.email,
        password: userCredentials.password,
      },
    });
    const cookie = loginResponse.headers["set-cookie"];
    return Array.isArray(cookie) ? cookie.join("; ") : cookie;
  }

  async function getDbUser(email: string) {
    const [u] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);
    return u;
  }

  it("returns 401 when not authenticated for audiencias endpoints", async () => {
    const app = await createApp();

    const getRes = await app.inject({
      method: "GET",
      url: "/api/audiencias?fecha=2026-08-10",
    });
    expect(getRes.statusCode).toBe(401);

    const getOrphanRes = await app.inject({
      method: "GET",
      url: "/api/audiencias/orphan",
    });
    expect(getOrphanRes.statusCode).toBe(401);

    const postRes = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      payload: {
        abogadoId: "00000000-0000-0000-0000-000000000000",
        fecha: "2026-08-10",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    expect(postRes.statusCode).toBe(401);

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/audiencias/00000000-0000-0000-0000-000000000000/vincular",
      payload: {
        carpetaId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(patchRes.statusCode).toBe(401);
  });

  it("rejects audiencia creation with invalid abogado (wrong estudio)", async () => {
    const app = await createApp();
    const userCredentials = await seedUser(db);
    const cookie = await loginUser(app, userCredentials);

    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    // Use a non-existent abogado ID
    const postRes = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie },
      payload: {
        abogadoId: "00000000-0000-0000-0000-000000000000",
        fecha: "2026-08-10",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(postRes.statusCode).toBe(400);
    expect(postRes.json().error).toMatch(/abogado/i);
  });

  it("creates an audiencia linked to a carpeta and lists agenda by fecha with LEFT JOIN details", async () => {
    const app = await createApp();
    const userCredentials = await seedUser(db);
    const cookie = await loginUser(app, userCredentials);

    const [sector] = await db.select().from(sectores).where(eq(sectores.activo, true)).limit(1);
    const [estado] = await db.select().from(estadosCaso).where(eq(estadosCaso.activo, true)).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).where(eq(tiposAudiencia.activo, true)).limit(1);

    const dbUser = await getDbUser(userCredentials.email);

    // Create a carpeta first
    const expediente = `EXP-VALID-${Date.now()}`;
    const createRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente,
        caratula: "Caso Agenda Test",
        demandada: "Demandada Agenda",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const carpeta = createRes.json();

    // Create audiencia with valid abogado
    const postRes = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: dbUser.id,
        fecha: "2026-08-10",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(postRes.statusCode).toBe(201);
    const audiencia = postRes.json();
    expect(audiencia.id).toBeDefined();
    expect(audiencia.carpetaId).toBe(carpeta.id);
    expect(audiencia.abogadoId).toBe(dbUser.id);
    expect(audiencia.fecha).toBe("2026-08-10");
    expect(audiencia.hora).toBe("10:00:00");

    // Create a second audiencia with later time
    const postRes2 = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie },
      payload: {
        abogadoId: dbUser.id,
        fecha: "2026-08-10",
        hora: "15:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(postRes2.statusCode).toBe(201);

    // List agenda by fecha — should return both, ordered by hora
    const agendaRes = await app.inject({
      method: "GET",
      url: "/api/audiencias?fecha=2026-08-10",
      headers: { cookie },
    });
    expect(agendaRes.statusCode).toBe(200);
    const agenda = agendaRes.json();
    expect(agenda).toHaveLength(2);
    expect(agenda[0].hora).toBe("10:00:00");
    expect(agenda[1].hora).toBe("15:00:00");

    // The one with carpeta should have caratula via LEFT JOIN
    const withCarpeta = agenda.find((a: any) => a.carpetaId === carpeta.id);
    expect(withCarpeta.caratula).toBe("Caso Agenda Test");
    expect(withCarpeta.tipoColor).toBeDefined();

    // The orphan one should have null caratula
    const orphan = agenda.find((a: any) => a.carpetaId === null);
    expect(orphan.caratula).toBeNull();
  });

  it("creates an orphan audiencia and lists it in orphan tray", async () => {
    const app = await createApp();
    const userCredentials = await seedUser(db);
    const cookie = await loginUser(app, userCredentials);

    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    const dbUser = await getDbUser(userCredentials.email);

    // Create orphan audiencia (no carpetaId)
    const postRes = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie },
      payload: {
        abogadoId: dbUser.id,
        fecha: "2026-08-11",
        hora: "14:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(postRes.statusCode).toBe(201);
    const orphan = postRes.json();
    expect(orphan.carpetaId).toBeNull();

    // Also create a linked audiencia that should NOT appear in orphan tray
    const [sector] = await db.select().from(sectores).where(eq(sectores.activo, true)).limit(1);
    const [estado] = await db.select().from(estadosCaso).where(eq(estadosCaso.activo, true)).limit(1);
    const expediente = `EXP-NOT-ORPHAN-${Date.now()}`;
    const carpetaRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente,
        caratula: "No soy huérfana",
        demandada: "Con Carpeta",
      },
    });
    const carpeta = carpetaRes.json();

    await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: dbUser.id,
        fecha: "2026-08-11",
        hora: "16:00",
        tipoAudienciaId: tipo.id,
      },
    });

    // List orphan tray — should only have 1 (the one without carpeta)
    const orphanRes = await app.inject({
      method: "GET",
      url: "/api/audiencias/orphan",
      headers: { cookie },
    });
    expect(orphanRes.statusCode).toBe(200);
    const orphans = orphanRes.json();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe(orphan.id);
  });

  it("links an orphan audiencia to a carpeta and creates bitacora entry", async () => {
    const app = await createApp();
    const userCredentials = await seedUser(db);
    const cookie = await loginUser(app, userCredentials);

    const [sector] = await db.select().from(sectores).where(eq(sectores.activo, true)).limit(1);
    const [estado] = await db.select().from(estadosCaso).where(eq(estadosCaso.activo, true)).limit(1);
    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    const dbUser = await getDbUser(userCredentials.email);

    // Create orphan audiencia
    const postRes = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie },
      payload: {
        abogadoId: dbUser.id,
        fecha: "2026-08-12",
        hora: "09:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(postRes.statusCode).toBe(201);
    const orphan = postRes.json();

    // Create a carpeta to link to
    const expediente = `EXP-LINK-API-${Date.now()}`;
    const carpetaRes = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente,
        caratula: "Caso para vincular API",
        demandada: "Demandada Link API",
      },
    });
    expect(carpetaRes.statusCode).toBe(201);
    const carpeta = carpetaRes.json();

    // Link orphan to carpeta
    const linkRes = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${orphan.id}/vincular`,
      headers: { cookie },
      payload: { carpetaId: carpeta.id },
    });
    expect(linkRes.statusCode).toBe(200);
    const linked = linkRes.json();
    expect(linked.carpetaId).toBe(carpeta.id);

    // Verify bitacora entry in DB
    const bitacoraEntries = await db
      .select()
      .from(bitacoraCarpetas)
      .where(eq(bitacoraCarpetas.carpetaId, carpeta.id));

    const vinculacionEntry = bitacoraEntries.find(
      (e) => e.accionRealizada === "audiencia_vinculada",
    );
    expect(vinculacionEntry).toBeDefined();
    expect(vinculacionEntry?.metadata).toMatchObject({ audienciaId: orphan.id });

    // Linking again should fail (already linked)
    const linkAgainRes = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${orphan.id}/vincular`,
      headers: { cookie },
      payload: { carpetaId: carpeta.id },
    });
    expect(linkAgainRes.statusCode).toBe(400);
    expect(linkAgainRes.json().error).toMatch(/ya está vinculada/);
  });

  it("prevents cross-tenant access to audiencias", async () => {
    const app = await createApp();

    // Seed two users in different estudios
    const user1Credentials = await seedUser(db);
    const cookie1 = await loginUser(app, user1Credentials);

    // Create second estudio + user
    const [estudio2] = await db
      .insert(estudios)
      .values({ nombre: "Estudio Malicioso" })
      .returning();

    const user2Credentials = await seedUser(db, {
      email: "malicioso@test.com",
      password: "Hack3rP@ss",
    });

    // Update user2 to belong to estudio2
    await db
      .update(usuarios)
      .set({ estudioId: estudio2.id })
      .where(eq(usuarios.email, user2Credentials.email));

    const cookie2 = await loginUser(app, user2Credentials);

    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    // User1 creates an audiencia
    const [dbUser1] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.email, user1Credentials.email))
      .limit(1);

    const postRes = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: cookie1 },
      payload: {
        abogadoId: dbUser1.id,
        fecha: "2026-08-13",
        hora: "11:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(postRes.statusCode).toBe(201);
    const audienciaUser1 = postRes.json();

    // User2 tries to link user1's audiencia — should fail (not found)
    const linkRes = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${audienciaUser1.id}/vincular`,
      headers: { cookie: cookie2 },
      payload: {
        carpetaId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(linkRes.statusCode).toBe(404);

    // User2's orphan tray should be empty
    const orphanRes = await app.inject({
      method: "GET",
      url: "/api/audiencias/orphan",
      headers: { cookie: cookie2 },
    });
    expect(orphanRes.statusCode).toBe(200);
    expect(orphanRes.json()).toHaveLength(0);

    // User1's orphan tray should have the audiencia
    const orphanRes1 = await app.inject({
      method: "GET",
      url: "/api/audiencias/orphan",
      headers: { cookie: cookie1 },
    });
    expect(orphanRes1.statusCode).toBe(200);
    expect(orphanRes1.json()).toHaveLength(1);
  });
});
