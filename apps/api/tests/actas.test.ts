import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { eq, sql } from "drizzle-orm";
import {
  actas,
  audiencias,
  bitacoraCarpetas,
  carpetas,
  estadosActa,
  estadosCaso,
  estudios,
  sectores,
  tiposActa,
  usuarios,
  usuariosSectores,
} from "@sechub/db";
import { buildApp } from "../src/app.js";
import { createTestDatabase, createTestSupabaseClient, getDatabaseUrl, resetDatabase, seedUser } from "./helpers/db.js";

describe("actas API", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
    await db.execute(sql`DROP TRIGGER IF EXISTS test_acta_link_gate ON actas`);
    await db.execute(sql`DROP FUNCTION IF EXISTS test_acta_link_gate()`);
  });

  async function createApp() {
    return buildApp({ db, environment: "test", supabase: createTestSupabaseClient() });
  }

  async function loginUser(_app: any, userCredentials: { authHeader: string }) { return userCredentials.authHeader; }

  async function createLinkScenario(label: string) {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-${label}-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email));
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);
    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-${label}-${Date.now()}`,
        caratula: "Acta test",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();
    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: user.id,
        fecha: "2026-02-10",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });
    return {
      app,
      cookie,
      user,
      carpeta,
      audiencia: audienciaResponse.json(),
      acta: actaResponse.json(),
      estadoCaso,
    };
  }

  it("rejects unauthenticated acta create, orphan listing, and linking", async () => {
    const app = await createApp();
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/actas",
        payload: { tipoActaId: 1, estadoActaId: 1 },
      }),
      app.inject({ method: "GET", url: "/api/actas/orphan" }),
      app.inject({
        method: "PATCH",
        url: "/api/actas/00000000-0000-0000-0000-000000000000/vincular",
        payload: {
          carpetaId: "00000000-0000-0000-0000-000000000000",
          audienciaId: "00000000-0000-0000-0000-000000000000",
        },
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401]);
  });

  it("rolls back when audiencia and carpeta do not match", async () => {
    const scenario = await createLinkScenario("mismatch");
    const [otherSector] = await db.select().from(sectores).limit(1);
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const otherCarpetaResponse = await scenario.app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: scenario.cookie },
      payload: {
        sectorActualId: otherSector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-MISMATCH-OTHER-${Date.now()}`,
        caratula: "Otra carpeta",
        demandada: "Demandada",
      },
    });
    const otherCarpeta = otherCarpetaResponse.json();
    const otherAudienciaResponse = await scenario.app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: scenario.cookie },
      payload: {
        carpetaId: otherCarpeta.id,
        abogadoId: scenario.user.id,
        fecha: "2026-02-11",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const response = await scenario.app.inject({
      method: "PATCH",
      url: `/api/actas/${scenario.acta.id}/vincular`,
      headers: { authorization: scenario.cookie },
      payload: { carpetaId: scenario.carpeta.id, audienciaId: otherAudienciaResponse.json().id },
    });
    const [unchangedActa] = await db.select().from(actas).where(eq(actas.id, scenario.acta.id));
    const [unchangedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, scenario.carpeta.id));
    const [otherAudiencia] = await db.select().from(audiencias).where(eq(audiencias.id, otherAudienciaResponse.json().id));
    expect(response.statusCode).toBe(400);
    expect(unchangedActa.carpetaId).toBeNull();
    expect(unchangedCarpeta.version).toBe(scenario.carpeta.version);
    expect(unchangedCarpeta.estadoCasoId).toBe(scenario.carpeta.estadoCasoId);
    expect(otherAudiencia.estado).toBe("pendiente");
  });

  it("rolls back when the selected audiencia is not pending", async () => {
    const scenario = await createLinkScenario("nonpending");
    await db.update(audiencias).set({ estado: "realizada" }).where(eq(audiencias.id, scenario.audiencia.id));
    const response = await scenario.app.inject({
      method: "PATCH",
      url: `/api/actas/${scenario.acta.id}/vincular`,
      headers: { authorization: scenario.cookie },
      payload: { carpetaId: scenario.carpeta.id, audienciaId: scenario.audiencia.id },
    });
    const [unchangedActa] = await db.select().from(actas).where(eq(actas.id, scenario.acta.id));
    const [unchangedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, scenario.carpeta.id));
    expect(response.statusCode).toBe(400);
    expect(unchangedActa.carpetaId).toBeNull();
    expect(unchangedCarpeta.version).toBe(scenario.carpeta.version);
    expect(unchangedCarpeta.estadoCasoId).toBe(scenario.carpeta.estadoCasoId);
  });

  it("realizes only the explicitly selected pending audiencia", async () => {
    const scenario = await createLinkScenario("explicit-audiencia");
    const secondAudienciaResponse = await scenario.app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: scenario.cookie },
      payload: {
        carpetaId: scenario.carpeta.id,
        abogadoId: scenario.user.id,
        fecha: "2026-02-12",
        hora: "11:00",
        tipoAudienciaId: 1,
      },
    });
    const response = await scenario.app.inject({
      method: "PATCH",
      url: `/api/actas/${scenario.acta.id}/vincular`,
      headers: { authorization: scenario.cookie },
      payload: { carpetaId: scenario.carpeta.id, audienciaId: scenario.audiencia.id },
    });
    const [selected] = await db.select().from(audiencias).where(eq(audiencias.id, scenario.audiencia.id));
    const [other] = await db.select().from(audiencias).where(eq(audiencias.id, secondAudienciaResponse.json().id));
    expect(response.statusCode).toBe(200);
    expect(selected.estado).toBe("realizada");
    expect(other.estado).toBe("pendiente");
  });

  it("creates an orphan acta and lists only the tenant's orphans", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-api-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [tipo] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estado] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));

    const response = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: {
        expediente: `ACTA-API-${Date.now()}`,
        tipoActaId: tipo.id,
        estadoActaId: estado.id,
        fecha: "2026-02-01",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().carpetaId).toBeNull();

    const orphanResponse = await app.inject({
      method: "GET",
      url: "/api/actas/orphan",
      headers: { authorization: cookie },
    });

    expect(orphanResponse.statusCode).toBe(200);
    expect(orphanResponse.json()).toHaveLength(1);
    expect(orphanResponse.json()[0].id).toBe(response.json().id);
  });

  it("rejects an empty carpeta ID instead of treating it as an orphan", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-invalid-carpeta-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));

    const response = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: {
        carpetaId: "",
        tipoActaId: tipoActa.id,
        estadoActaId: estadoActa.id,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("ID de carpeta inválido");
  });

  it("creates an acta directly linked without applying link side effects", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-direct-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "pase_segunda_fecha"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-DIRECT-${Date.now()}`,
        caratula: "Acta directa",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();

    const response = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        tipoActaId: tipoActa.id,
        estadoActaId: estadoActa.id,
      },
    });

    expect(response.statusCode).toBe(201);
    const [persistedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, carpeta.id));
    expect(response.json().carpetaId).toBe(carpeta.id);
    expect(persistedCarpeta.version).toBe(carpeta.version);
    expect(persistedCarpeta.estadoCasoId).toBe(carpeta.estadoCasoId);
  });

  it("links an acta once and applies mapped carpeta and audiencia side effects", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-link-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email));
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-CARPETA-${Date.now()}`,
        caratula: "Acta vinculada",
        demandada: "Demandada",
      },
    });
    expect(carpetaResponse.statusCode).toBe(201);
    const carpeta = carpetaResponse.json();

    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: user.id,
        fecha: "2026-02-02",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    expect(audienciaResponse.statusCode).toBe(201);

    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: {
        expediente: carpeta.expediente,
        tipoActaId: tipoActa.id,
        estadoActaId: estadoActa.id,
        fecha: "2026-02-03",
      },
    });
    expect(actaResponse.statusCode).toBe(201);

    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${actaResponse.json().id}/vincular`,
      headers: { authorization: cookie },
      payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id },
    });
    expect(linkResponse.statusCode).toBe(200);
    const retryResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${actaResponse.json().id}/vincular`,
      headers: { authorization: cookie },
      payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id },
    });

    const [linked] = await db.select().from(actas).where(eq(actas.id, actaResponse.json().id));
    const [updatedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, carpeta.id));
    const [updatedAudiencia] = await db.select().from(audiencias).where(eq(audiencias.id, audienciaResponse.json().id));
    const entries = await db.select().from(bitacoraCarpetas).where(eq(bitacoraCarpetas.carpetaId, carpeta.id));
    const [conciliado] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "conciliado"));

    expect(retryResponse.statusCode).toBe(400);
    expect(linked.carpetaId).toBe(carpeta.id);
    expect(updatedCarpeta.version).toBe(carpeta.version + 1);
    expect(updatedCarpeta.estadoCasoId).toBe(conciliado.id);
    expect(updatedAudiencia.estado).toBe("realizada");
    expect(entries.filter((entry) => entry.accionRealizada === "acta_vinculada")).toHaveLength(1);
    expect(entries.find((entry) => entry.accionRealizada === "acta_vinculada")?.metadata).toEqual({
      tipo_acta: "acuerdo",
      estado_anterior: "en_tramite",
      estado_nuevo: "conciliado",
    });
  });

  it("discovers the exact acta catalogs", async () => {
    const app = await createApp();

    const typesResponse = await app.inject({ method: "GET", url: "/api/tipos-acta" });
    const statesResponse = await app.inject({ method: "GET", url: "/api/estados-acta" });

    expect(typesResponse.statusCode).toBe(200);
    expect(typesResponse.json().map((row: { codigo: string }) => row.codigo)).toEqual([
      "audiencia_conciliatoria",
      "pase_segunda_fecha",
      "acuerdo",
      "desistimiento",
    ]);
    expect(statesResponse.statusCode).toBe(200);
    expect(statesResponse.json().map((row: { codigo: string }) => row.codigo)).toEqual([
      "pendiente",
      "firmada",
      "archivada",
    ]);
  });

  it("blocks lectura from creating or linking actas while preserving reads", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: `acta-permission-admin-${Date.now()}@test.com` });
    const lecturaCredentials = await seedUser(db, {
      email: `acta-permission-lectura-${Date.now()}@test.com`,
      role: "lectura",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const lecturaCookie = await loginUser(app, lecturaCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email));
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: adminCookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-PERMISSION-${Date.now()}`,
        caratula: "Permisos",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();
    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: adminCookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: admin.id,
        fecha: "2026-02-04",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: adminCookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: lecturaCookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });
    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${actaResponse.json().id}/vincular`,
      headers: { authorization: lecturaCookie },
      payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id },
    });
    const orphanResponse = await app.inject({
      method: "GET",
      url: "/api/actas/orphan",
      headers: { authorization: lecturaCookie },
    });

    expect(createResponse.statusCode).toBe(403);
    expect(linkResponse.statusCode).toBe(403);
    expect(orphanResponse.statusCode).toBe(200);
  });

  it("keeps actas isolated between tenants", async () => {
    const app = await createApp();
    const firstCredentials = await seedUser(db, { email: `acta-tenant-one-${Date.now()}@test.com` });
    const firstCookie = await loginUser(app, firstCredentials);
    const [firstUser] = await db.select().from(usuarios).where(eq(usuarios.email, firstCredentials.email));
    const [foreignEstudio] = await db.insert(estudios).values({ nombre: `Acta tenant ${Date.now()}` }).returning();
    const secondCredentials = await seedUser(db, { email: `acta-tenant-two-${Date.now()}@test.com` });
    await db.update(usuarios).set({ estudioId: foreignEstudio.id }).where(eq(usuarios.email, secondCredentials.email));
    const secondCookie = await loginUser(app, secondCredentials);
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: firstCookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id, expediente: `ACTA-TENANT-${Date.now()}` },
    });
    const actaId = createResponse.json().id;
    const orphanResponse = await app.inject({
      method: "GET",
      url: "/api/actas/orphan",
      headers: { authorization: secondCookie },
    });
    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${actaId}/vincular`,
      headers: { authorization: secondCookie },
      payload: {
        carpetaId: "00000000-0000-0000-0000-000000000000",
        audienciaId: "00000000-0000-0000-0000-000000000000",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(orphanResponse.statusCode).toBe(200);
    expect(orphanResponse.json()).toHaveLength(0);
    expect(linkResponse.statusCode).toBe(404);
    expect(firstUser.estudioId).not.toBe(foreignEstudio.id);
  });

  it.each([
    ["audiencia_conciliatoria", "en_tramite"],
    ["pase_segunda_fecha", "en_tramite"],
    ["acuerdo", "conciliado"],
    ["desistimiento", "desestimado"],
  ])("maps %s actas to %s", async (tipoCodigo, expectedEstadoCodigo) => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-mapping-${tipoCodigo}-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email));
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, tipoCodigo));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-MAPPING-${tipoCodigo}-${Date.now()}`,
        caratula: "Mapping",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();
    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: user.id,
        fecha: "2026-02-05",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });
    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${actaResponse.json().id}/vincular`,
      headers: { authorization: cookie },
      payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id },
    });
    const [expectedEstado] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, expectedEstadoCodigo));
    const [updatedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, carpeta.id));

    expect(linkResponse.statusCode).toBe(200);
    expect(updatedCarpeta.estadoCasoId).toBe(expectedEstado.id);
  });

  it("rolls back every side effect when audiencia validation fails", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-rollback-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email));
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);
    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-ROLLBACK-${Date.now()}`,
        caratula: "Rollback",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();
    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: user.id,
        fecha: "2026-02-06",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });

    const linkResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${actaResponse.json().id}/vincular`,
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        audienciaId: "00000000-0000-0000-0000-000000000000",
      },
    });

    expect(linkResponse.statusCode).toBe(400);

    const [unchangedActa] = await db.select().from(actas).where(eq(actas.id, actaResponse.json().id));
    const [unchangedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, carpeta.id));
    const [unchangedAudiencia] = await db.select().from(audiencias).where(eq(audiencias.id, audienciaResponse.json().id));
    const entries = await db.select().from(bitacoraCarpetas).where(eq(bitacoraCarpetas.carpetaId, carpeta.id));

    expect(unchangedActa.carpetaId).toBeNull();
    expect(unchangedCarpeta.version).toBe(carpeta.version);
    expect(unchangedCarpeta.estadoCasoId).toBe(carpeta.estadoCasoId);
    expect(unchangedAudiencia.estado).toBe("pendiente");
    expect(entries.filter((entry) => entry.accionRealizada === "acta_vinculada")).toHaveLength(0);
  });

  it("allows responsable_sector only for assigned target sectors", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: `acta-sector-admin-${Date.now()}@test.com` });
    const managerCredentials = await seedUser(db, {
      email: `acta-sector-manager-${Date.now()}@test.com`,
      role: "responsable_sector",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const managerCookie = await loginUser(app, managerCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email));
    const [manager] = await db.select().from(usuarios).where(eq(usuarios.email, managerCredentials.email));
    const [assignedSector, otherSector] = await db.select().from(sectores).limit(2);
    await db.insert(usuariosSectores).values({ usuarioId: manager.id, sectorId: assignedSector.id });
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));

    async function createTarget(sectorId: number, label: string) {
      const carpetaResponse = await app.inject({
        method: "POST",
        url: "/api/carpetas",
        headers: { authorization: adminCookie },
        payload: {
          sectorActualId: sectorId,
          estadoCasoId: estadoCaso.id,
          expediente: `ACTA-SECTOR-${label}-${Date.now()}`,
          caratula: "Permisos sectoriales",
          demandada: "Demandada",
        },
      });
      const carpeta = carpetaResponse.json();
      const audienciaResponse = await app.inject({
        method: "POST",
        url: "/api/audiencias",
        headers: { authorization: adminCookie },
        payload: {
          carpetaId: carpeta.id,
          abogadoId: admin.id,
          fecha: "2026-02-13",
          hora: "10:00",
          tipoAudienciaId: 1,
        },
      });
      const actaResponse = await app.inject({
        method: "POST",
        url: "/api/actas",
        headers: { authorization: adminCookie },
        payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
      });
      return { carpeta, audiencia: audienciaResponse.json(), acta: actaResponse.json() };
    }

    const assigned = await createTarget(assignedSector.id, "assigned");
    const allowedResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${assigned.acta.id}/vincular`,
      headers: { authorization: managerCookie },
      payload: { carpetaId: assigned.carpeta.id, audienciaId: assigned.audiencia.id },
    });
    expect(allowedResponse.statusCode).toBe(200);

    const denied = await createTarget(otherSector.id, "denied");
    const deniedResponse = await app.inject({
      method: "PATCH",
      url: `/api/actas/${denied.acta.id}/vincular`,
      headers: { authorization: managerCookie },
      payload: { carpetaId: denied.carpeta.id, audienciaId: denied.audiencia.id },
    });
    const [unchangedDeniedActa] = await db.select().from(actas).where(eq(actas.id, denied.acta.id));
    const [unchangedDeniedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, denied.carpeta.id));
    const [unchangedDeniedAudiencia] = await db.select().from(audiencias).where(eq(audiencias.id, denied.audiencia.id));
    expect(deniedResponse.statusCode).toBe(403);
    expect(unchangedDeniedActa.carpetaId).toBeNull();
    expect(unchangedDeniedCarpeta.version).toBe(denied.carpeta.version);
    expect(unchangedDeniedAudiencia.estado).toBe("pendiente");
  });

  it("authorizes against the sector transferred before the carpeta lock", async () => {
    const app = await createApp();
    const adminCredentials = await seedUser(db, { email: `acta-transfer-admin-${Date.now()}@test.com` });
    const managerCredentials = await seedUser(db, {
      email: `acta-transfer-manager-${Date.now()}@test.com`,
      role: "responsable_sector",
    });
    const adminCookie = await loginUser(app, adminCredentials);
    const managerCookie = await loginUser(app, managerCredentials);
    const [admin] = await db.select().from(usuarios).where(eq(usuarios.email, adminCredentials.email));
    const [manager] = await db.select().from(usuarios).where(eq(usuarios.email, managerCredentials.email));
    const [oldSector, newSector] = await db.select().from(sectores).limit(2);
    await db.insert(usuariosSectores).values({ usuarioId: manager.id, sectorId: oldSector.id });
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));

    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: adminCookie },
      payload: {
        sectorActualId: oldSector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-TRANSFER-${Date.now()}`,
        caratula: "Transferencia concurrente",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();
    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: adminCookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: admin.id,
        fecha: "2026-02-08",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: adminCookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });

    const transferClient = new Client({ connectionString: getDatabaseUrl() });
    const observerClient = new Client({ connectionString: getDatabaseUrl() });
    await transferClient.connect();
    await observerClient.connect();
    try {
      await transferClient.query("BEGIN");
      await transferClient.query("SELECT id FROM actas WHERE id = $1 FOR UPDATE", [actaResponse.json().id]);
      const linkPromise = app.inject({
        method: "PATCH",
        url: `/api/actas/${actaResponse.json().id}/vincular`,
        headers: { authorization: managerCookie },
        payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id },
      });
      let actaUpdateBlocked = false;
      while (!actaUpdateBlocked) {
        const result = await observerClient.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
               AND query ILIKE '%actas%'
               AND query ILIKE '%update%'
           ) AS exists`,
        );
        actaUpdateBlocked = result.rows[0].exists;
        if (!actaUpdateBlocked) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      await transferClient.query(
        "UPDATE carpetas SET sector_actual_id = $1 WHERE id = $2",
        [newSector.id, carpeta.id],
      );
      await transferClient.query("COMMIT");
      const linkResponse = await linkPromise;

      expect(linkResponse.statusCode).toBe(403);
      const [unchangedActa] = await db.select().from(actas).where(eq(actas.id, actaResponse.json().id));
      const [transferredCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, carpeta.id));
      const [unchangedAudiencia] = await db.select().from(audiencias).where(eq(audiencias.id, audienciaResponse.json().id));
      expect(unchangedActa.carpetaId).toBeNull();
      expect(transferredCarpeta.sectorActualId).toBe(newSector.id);
      expect(transferredCarpeta.version).toBe(carpeta.version);
      expect(unchangedAudiencia.estado).toBe("pendiente");
    } finally {
      await transferClient.query("ROLLBACK").catch(() => undefined);
      await transferClient.end();
      await observerClient.end();
    }
  });

  it("serializes different actas on one carpeta and records committed prior states", async () => {
    const scenario = await createLinkScenario("same-carpeta");
    const secondAudienciaResponse = await scenario.app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: scenario.cookie },
      payload: {
        carpetaId: scenario.carpeta.id,
        abogadoId: scenario.user.id,
        fecha: "2026-02-14",
        hora: "11:00",
        tipoAudienciaId: 1,
      },
    });
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const secondActaResponse = await scenario.app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: scenario.cookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });
    const responses = await Promise.all([
      scenario.app.inject({
        method: "PATCH",
        url: `/api/actas/${scenario.acta.id}/vincular`,
        headers: { authorization: scenario.cookie },
        payload: { carpetaId: scenario.carpeta.id, audienciaId: scenario.audiencia.id },
      }),
      scenario.app.inject({
        method: "PATCH",
        url: `/api/actas/${secondActaResponse.json().id}/vincular`,
        headers: { authorization: scenario.cookie },
        payload: { carpetaId: scenario.carpeta.id, audienciaId: secondAudienciaResponse.json().id },
      }),
    ]);
    const [updatedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, scenario.carpeta.id));
    const entries = await db.select().from(bitacoraCarpetas).where(eq(bitacoraCarpetas.carpetaId, scenario.carpeta.id));
    const metadata = entries
      .filter((entry) => entry.accionRealizada === "acta_vinculada")
      .map((entry) => entry.metadata)
      .sort((left, right) => String((left as { estado_anterior: string }).estado_anterior).localeCompare(String((right as { estado_anterior: string }).estado_anterior)));

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(updatedCarpeta.version).toBe(scenario.carpeta.version + 2);
    expect(metadata).toEqual([
      { tipo_acta: "acuerdo", estado_anterior: "conciliado", estado_nuevo: "conciliado" },
      { tipo_acta: "acuerdo", estado_anterior: "en_tramite", estado_nuevo: "conciliado" },
    ]);
  });

  it("does not double-process concurrent linking attempts", async () => {
    const app = await createApp();
    const credentials = await seedUser(db, { email: `acta-race-${Date.now()}@test.com` });
    const cookie = await loginUser(app, credentials);
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, credentials.email));
    const [tipoActa] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [estadoActa] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));
    const [estadoCaso] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));
    const [sector] = await db.select().from(sectores).limit(1);
    const carpetaResponse = await app.inject({
      method: "POST",
      url: "/api/carpetas",
      headers: { authorization: cookie },
      payload: {
        sectorActualId: sector.id,
        estadoCasoId: estadoCaso.id,
        expediente: `ACTA-RACE-${Date.now()}`,
        caratula: "Race",
        demandada: "Demandada",
      },
    });
    const carpeta = carpetaResponse.json();
    const audienciaResponse = await app.inject({
      method: "POST",
      url: "/api/audiencias",
      headers: { authorization: cookie },
      payload: {
        carpetaId: carpeta.id,
        abogadoId: user.id,
        fecha: "2026-02-07",
        hora: "10:00",
        tipoAudienciaId: 1,
      },
    });
    const actaResponse = await app.inject({
      method: "POST",
      url: "/api/actas",
      headers: { authorization: cookie },
      payload: { tipoActaId: tipoActa.id, estadoActaId: estadoActa.id },
    });
    const url = `/api/actas/${actaResponse.json().id}/vincular`;
    const responses = await Promise.all([
      app.inject({ method: "PATCH", url, headers: { authorization: cookie }, payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id } }),
      app.inject({ method: "PATCH", url, headers: { authorization: cookie }, payload: { carpetaId: carpeta.id, audienciaId: audienciaResponse.json().id } }),
    ]);
    const [updatedCarpeta] = await db.select().from(carpetas).where(eq(carpetas.id, carpeta.id));
    const [updatedAudiencia] = await db.select().from(audiencias).where(eq(audiencias.id, audienciaResponse.json().id));
    const entries = await db.select().from(bitacoraCarpetas).where(eq(bitacoraCarpetas.carpetaId, carpeta.id));

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode !== 200)).toHaveLength(1);
    expect(updatedCarpeta.version).toBe(carpeta.version + 1);
    expect(updatedAudiencia.estado).toBe("realizada");
    expect(entries.filter((entry) => entry.accionRealizada === "acta_vinculada")).toHaveLength(1);
  });
});
