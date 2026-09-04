import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  sectores,
  empleadores,
  estadosCaso,
  estudios,
  tiposAudiencia,
  usuarios,
  usuariosRoles,
  usuariosSectores,
  roles,
  audiencias,
} from "../../../packages/db/src/index.js";
import { buildApp } from "../src/app.js";
import { createTestDatabase, resetDatabase, seedUser } from "./helpers/db.js";

describe("permisos por rol y sector API", async () => {
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

  async function loginUser(app: Awaited<ReturnType<typeof buildApp>>, credentials: { email: string; password: string }) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials,
    });
    const cookie = response.headers["set-cookie"];
    return Array.isArray(cookie) ? cookie.join("; ") : cookie;
  }

  async function assignSector(email: string, sectorId: number) {
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    await db.insert(usuariosSectores).values({ usuarioId: user.id, sectorId });
    return user;
  }

  it("uses the current normalized role assignment on the next protected request", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, {
      email: `role-change-${Date.now()}@test.com`,
      role: "lectura",
    });
    const cookie = await loginUser(app, credentials);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email)).limit(1);
    const [adminRole] = await db.select().from(roles).where(eq(roles.codigo, "admin")).limit(1);
    const payload = {
      sectorActualId: sector.id,
      estadoCasoId: estado.id,
      expediente: `ROLE-CHANGE-${Date.now()}`,
      caratula: "Carpeta con rol actualizado",
      demandada: "Demandada",
    };

    const lecturaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie },
      payload,
    });
    expect(lecturaResponse.statusCode).toBe(403);

    await db.delete(usuariosRoles).where(eq(usuariosRoles.usuarioId, user.id));
    await db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: adminRole.id });

    const adminResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie },
      payload,
    });
    expect(adminResponse.statusCode).toBe(201);
  });

  it("denies protected writes after the normalized role changes to lectura", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, {
      email: `normalized-role-${Date.now()}@test.com`,
      role: "admin",
    });
    const cookie = await loginUser(app, credentials);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email)).limit(1);

    const [lecturaRole] = await db.select().from(roles).where(eq(roles.codigo, "lectura")).limit(1);
    await db.delete(usuariosRoles).where(eq(usuariosRoles.usuarioId, user.id));
    await db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: lecturaRole.id });

    const response = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: `NORMALIZED-ROLE-${Date.now()}`,
        caratula: "Carpeta sin autorización",
        demandada: "Demandada",
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("allows admins to create carpetas and denies lectura writes", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: "admin-permisos@test.com" });
    const lecturaCredentials = await seedUser(db, { email: "lectura-permisos@test.com", role: "lectura" });
    const adminCookie = await loginUser(app, adminCredentials);
    const lecturaCookie = await loginUser(app, lecturaCredentials);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const payload = {
      sectorActualId: sector.id,
      estadoCasoId: estado.id,
      expediente: `PERMISOS-${Date.now()}`,
      caratula: "Carpeta autorizada",
      demandada: "Demandada",
    };

    const adminResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: adminCookie },
      payload,
    });
    expect(adminResponse.statusCode).toBe(201);

    const lecturaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: lecturaCookie },
      payload: { ...payload, expediente: `${payload.expediente}-lectura` },
    });
    expect(lecturaResponse.statusCode).toBe(403);
  });

  it("authorizes writes before validation and gives admins full write access", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: "admin-write-middleware@test.com" });
    const lecturaCredentials = await seedUser(db, {
      email: "lectura-write-middleware@test.com",
      role: "lectura",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const lecturaCookie = await loginUser(app, lecturaCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email)).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: adminCookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: `ADMIN-PATCH-${Date.now()}`,
        caratula: "Carpeta de administrador",
        demandada: "Demandada",
      },
    });
    expect(carpetaResponse.statusCode).toBe(201);
    const carpeta = carpetaResponse.json();

    const lecturaResponse = await app.inject({
      method: "PATCH",
      url: "/api/carpetas/not-a-uuid",
      headers: { cookie: lecturaCookie },
      payload: { version: 1 },
    });
    expect(lecturaResponse.statusCode).toBe(403);

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${carpeta.id}`,
      headers: { cookie: adminCookie },
      payload: { version: carpeta.version, caratula: "Carpeta actualizada" },
    });
    expect(patchResponse.statusCode).toBe(200);

    const orphanResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: adminCookie },
      payload: {
        abogadoId: admin.id,
        fecha: "2026-10-12",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(orphanResponse.statusCode).toBe(201);

    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${orphanResponse.json().id}/vincular`,
      headers: { cookie: adminCookie },
      payload: { carpetaId: carpeta.id },
    });
    expect(linkResponse.statusCode).toBe(200);
  });

  it("limits responsables to the current carpeta sector while allowing orphan audiencias", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: "admin-sector@test.com" });
    const managerCredentials = await seedUser(db, {
      email: "responsable-sector@test.com",
      role: "responsable_sector",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const managerCookie = await loginUser(app, managerCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email)).limit(1);
    const [ownSector, otherSector] = await db.select().from(sectores).limit(2);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).limit(1);
    await assignSector(managerCredentials.email, ownSector.id);

    const managerCarpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: managerCookie },
      payload: {
        sectorActualId: ownSector.id,
        estadoCasoId: estado.id,
        expediente: `MANAGER-OWN-${Date.now()}`,
        caratula: "Carpeta propia",
        demandada: "Demandada",
      },
    });
    expect(managerCarpetaResponse.statusCode).toBe(201);
    const managerCarpeta = managerCarpetaResponse.json();

    const otherCarpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: adminCookie },
      payload: {
        sectorActualId: otherSector.id,
        estadoCasoId: estado.id,
        expediente: `ADMIN-OTHER-${Date.now()}`,
        caratula: "Carpeta ajena",
        demandada: "Demandada",
      },
    });
    expect(otherCarpetaResponse.statusCode).toBe(201);
    const otherCarpeta = otherCarpetaResponse.json();

    const createOtherResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: managerCookie },
      payload: {
        sectorActualId: otherSector.id,
        estadoCasoId: estado.id,
        expediente: `MANAGER-OTHER-${Date.now()}`,
        caratula: "No autorizada",
        demandada: "Demandada",
      },
    });
    expect(createOtherResponse.statusCode).toBe(403);

    const transitionResponse = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${managerCarpeta.id}`,
      headers: { cookie: managerCookie },
      payload: { version: managerCarpeta.version, sectorActualId: otherSector.id },
    });
    expect(transitionResponse.statusCode).toBe(200);

    const updateOtherResponse = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${otherCarpeta.id}`,
      headers: { cookie: managerCookie },
      payload: { version: otherCarpeta.version, caratula: "No autorizada" },
    });
    expect(updateOtherResponse.statusCode).toBe(403);

    const linkedCreationResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: managerCookie },
      payload: {
        carpetaId: otherCarpeta.id,
        abogadoId: admin.id,
        fecha: "2026-10-10",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(linkedCreationResponse.statusCode).toBe(403);

    const orphanResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: managerCookie },
      payload: {
        abogadoId: admin.id,
        fecha: "2026-10-10",
        hora: "11:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(orphanResponse.statusCode).toBe(201);

    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${orphanResponse.json().id}/vincular`,
      headers: { cookie: managerCookie },
      payload: { carpetaId: otherCarpeta.id },
    });
    expect(linkResponse.statusCode).toBe(200);

    const linkedWriteResponse = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${orphanResponse.json().id}/vincular`,
      headers: { cookie: managerCookie },
      payload: { carpetaId: otherCarpeta.id },
    });
    expect(linkedWriteResponse.statusCode).toBe(403);
  });

  it("returns 403 before validating empleador ownership for unauthorized carpeta updates", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: "admin-patch-ownership@test.com" });
    const lecturaCredentials = await seedUser(db, {
      email: "lectura-patch-ownership@test.com",
      role: "lectura",
    });
    const managerCredentials = await seedUser(db, {
      email: "responsable-patch-ownership@test.com",
      role: "responsable_sector",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const lecturaCookie = await loginUser(app, lecturaCredentials);
    const managerCookie = await loginUser(app, managerCredentials);
    const [ownSector, otherSector] = await db.select().from(sectores).limit(2);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    await assignSector(managerCredentials.email, ownSector.id);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: adminCookie },
      payload: {
        sectorActualId: otherSector.id,
        estadoCasoId: estado.id,
        expediente: `PATCH-OWNERSHIP-${Date.now()}`,
        caratula: "Carpeta restringida",
        demandada: "Demandada",
      },
    });
    expect(carpetaResponse.statusCode).toBe(201);
    const carpeta = carpetaResponse.json();
    const [foreignEstudio] = await db.insert(estudios).values({
      nombre: `Estudio ajeno ${Date.now()}`,
    }).returning();
    const [foreignEmpleador] = await db.insert(empleadores).values({
      estudioId: foreignEstudio.id,
      razonSocial: "Empleador ajeno",
    }).returning();

    const lecturaResponse = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${carpeta.id}`,
      headers: { cookie: lecturaCookie },
      payload: { version: carpeta.version, empleadorId: "invalid-empleador-id" },
    });
    expect(lecturaResponse.statusCode).toBe(403);

    const managerResponse = await app.inject({
      method: "PATCH",
      url: `/api/carpetas/${carpeta.id}`,
      headers: { cookie: managerCookie },
      payload: {
        version: carpeta.version,
        empleadorId: foreignEmpleador.id,
      },
    });
    expect(managerResponse.statusCode).toBe(403);
  });

  it("allows admins to create audiencias linked to an owned carpeta", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: "admin-linked-audiencia@test.com" });
    const adminCookie = await loginUser(app, adminCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email)).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: adminCookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: `ADMIN-LINKED-AUD-${Date.now()}`,
        caratula: "Carpeta para audiencia",
        demandada: "Demandada",
      },
    });
    expect(carpetaResponse.statusCode).toBe(201);
    const carpeta = carpetaResponse.json();

    const response = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: adminCookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: admin.id,
        fecha: "2026-10-13",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().carpetaId).toBe(carpeta.id);
    const [persisted] = await db.select().from(audiencias).where(eq(audiencias.id, response.json().id)).limit(1);
    expect(persisted.carpetaId).toBe(carpeta.id);
  });

  it("allows responsables to create audiencias linked to a carpeta in an assigned sector", async () => {
    const app = await createApp();
    const managerCredentials = await seedUser(db, {
      email: "responsable-linked-audiencia@test.com",
      role: "responsable_sector",
    });
    const managerCookie = await loginUser(app, managerCredentials);
    const [sector] = await db.select().from(sectores).limit(1);
    const manager = await assignSector(managerCredentials.email, sector.id);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: managerCookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: `MANAGER-LINKED-AUD-${Date.now()}`,
        caratula: "Carpeta para audiencia responsable",
        demandada: "Demandada",
      },
    });
    expect(carpetaResponse.statusCode).toBe(201);
    const carpeta = carpetaResponse.json();

    const response = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: managerCookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: manager.id,
        fecha: "2026-10-14",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().carpetaId).toBe(carpeta.id);
    const [persisted] = await db.select().from(audiencias).where(eq(audiencias.id, response.json().id)).limit(1);
    expect(persisted.carpetaId).toBe(carpeta.id);
  });

  it("keeps reads available while blocking lectura from orphan and linked audiencia writes", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: "admin-audiencias@test.com" });
    const lecturaCredentials = await seedUser(db, {
      email: "lectura-audiencias@test.com",
      role: "lectura",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const lecturaCookie = await loginUser(app, lecturaCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email)).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { cookie: adminCookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: `LECTURA-AUD-${Date.now()}`,
        caratula: "Carpeta de lectura",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();

    const orphanResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: adminCookie },
      payload: {
        abogadoId: admin.id,
        fecha: "2026-10-11",
        hora: "10:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(orphanResponse.statusCode).toBe(201);

    const carpetasReadResponse = await app.inject({
      method: "GET",
      url: "/api/carpetas",
      headers: { cookie: lecturaCookie },
    });
    expect(carpetasReadResponse.statusCode).toBe(200);
    const agendaReadResponse = await app.inject({
      method: "GET",
      url: "/api/audiencias?fecha=2026-10-11",
      headers: { cookie: lecturaCookie },
    });
    expect(agendaReadResponse.statusCode).toBe(200);

    const orphanWriteResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: lecturaCookie },
      payload: {
        abogadoId: admin.id,
        fecha: "2026-10-11",
        hora: "11:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(orphanWriteResponse.statusCode).toBe(403);

    const linkedWriteResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { cookie: lecturaCookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: admin.id,
        fecha: "2026-10-11",
        hora: "12:00",
        tipoAudienciaId: tipo.id,
      },
    });
    expect(linkedWriteResponse.statusCode).toBe(403);

    const orphanLinkResponse = await app.inject({
      method: "PATCH",
      url: `/api/audiencias/${orphanResponse.json().id}/vincular`,
      headers: { cookie: lecturaCookie },
      payload: { carpetaId: carpeta.id },
    });
    expect(orphanLinkResponse.statusCode).toBe(403);
  });
});
