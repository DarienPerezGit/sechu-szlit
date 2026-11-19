import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  bitacoraCarpetas,
  estadosCaso,
  sectores,
  usuarios,
} from "../../../packages/db/src/index.js";
import { buildApp } from "../src/app.js";
import { AuthAdminError, type AuthAdmin } from "../src/utils/auth-admin.js";
import { createTestDatabase, createTestSupabaseClient, resetDatabase, seedUser } from "./helpers/db.js";

/**
 * Cubrir a un colega y administrar el equipo (mismo criterio que AVEXIS):
 * delegar pasa por el titular o por procuración, nunca por el abogado.
 */
describe("agenda compartida y administración del equipo", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
  });

  /** Doble de Supabase Auth: devuelve un id nuevo, o falla como el proveedor. */
  function fakeAuthAdmin(fail?: AuthAdminError): AuthAdmin & { creadas: string[] } {
    const creadas: string[] = [];
    return {
      creadas,
      async crearCuenta(email) {
        if (fail) throw fail;
        creadas.push(email);
        return { id: randomUUID() };
      },
    };
  }

  async function escenario(authAdmin: AuthAdmin | null = null) {
    const app = await buildApp({ db, environment: "test", supabase: createTestSupabaseClient(), authAdmin });
    const stamp = Date.now();
    const titular = await seedUser(db, { email: `titular-${stamp}@test.com` });
    const responsable = await seedUser(db, { email: `responsable-${stamp}@test.com`, role: "abogado", esTitular: false });
    const reemplazo = await seedUser(db, { email: `reemplazo-${stamp}@test.com`, role: "abogado", esTitular: false });
    const asistente = await seedUser(db, { email: `asistente-${stamp}@test.com`, role: "asistente" });
    const [sector] = await db.select().from(sectores).limit(1);
    const [enTramite] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));

    const send = (who: { authHeader: string }, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
      app.inject({ method, url, headers: { authorization: who.authHeader }, payload });

    const carpeta = (await send(titular, "POST", "/api/carpetas", {
      sectorActualId: sector.id,
      estadoCasoId: enTramite.id,
      expediente: `AGENDA-${stamp}`,
      caratula: "Gómez c/ Fábrica S.A.",
      demandada: "Fábrica S.A.",
      abogadoResponsableId: responsable.id,
    })).json();
    const audiencia = (await send(titular, "POST", "/api/audiencias", {
      carpetaId: carpeta.id, abogadoId: responsable.id, fecha: "2026-12-10", hora: "10:00", tipoAudienciaId: 1,
    })).json();

    return { app, titular, responsable, reemplazo, asistente, send, carpeta, audiencia };
  }

  const agendaIds = async (send: any, who: { authHeader: string }) =>
    (await send(who, "GET", "/api/audiencias?fecha=2026-12-10")).json();

  it("el titular o procuración reasignan una audiencia para cubrir a un colega", async () => {
    const { responsable, reemplazo, asistente, send, carpeta, audiencia } = await escenario();

    const reasignada = await send(asistente, "PATCH", `/api/audiencias/${audiencia.id}`, { abogadoId: reemplazo.id });
    expect(reasignada.statusCode).toBe(200);
    expect(reasignada.json().abogadoId).toBe(reemplazo.id);

    // El reemplazo la ve con número y carátula, y sabe que la carpeta no es suya.
    const [enSuAgenda] = await agendaIds(send, reemplazo);
    expect(enSuAgenda).toMatchObject({
      id: audiencia.id,
      expediente: carpeta.expediente,
      caratula: carpeta.caratula,
      carpetaAbogadoResponsableId: responsable.id,
    });
    // Pero no puede abrir la carpeta del colega.
    expect((await send(reemplazo, "GET", `/api/carpetas/${carpeta.id}`)).statusCode).toBe(403);
    // El responsable la sigue viendo: responde por todo el expediente.
    expect((await agendaIds(send, responsable)).map((a: { id: string }) => a.id)).toEqual([audiencia.id]);

    const [entrada] = await db
      .select()
      .from(bitacoraCarpetas)
      .where(and(eq(bitacoraCarpetas.carpetaId, carpeta.id), eq(bitacoraCarpetas.accionRealizada, "audiencia_reasignada")));
    expect(entrada.usuarioId).toBe(asistente.id);
    expect(entrada.metadata).toMatchObject({ abogado_anterior: responsable.id, abogado_nuevo: reemplazo.id });
  });

  it("un abogado no le pasa trabajo a otro, pero reprograma lo que está en su agenda", async () => {
    const { titular, responsable, reemplazo, asistente, send, audiencia } = await escenario();

    expect((await send(responsable, "PATCH", `/api/audiencias/${audiencia.id}`, { abogadoId: reemplazo.id })).statusCode).toBe(403);
    expect((await send(reemplazo, "PATCH", `/api/audiencias/${audiencia.id}`, { hora: "11:00" })).statusCode).toBe(403);

    const reprogramada = await send(responsable, "PATCH", `/api/audiencias/${audiencia.id}`, { fecha: "2026-12-11", hora: "09:30" });
    expect(reprogramada.statusCode).toBe(200);
    expect(reprogramada.json()).toMatchObject({ fecha: "2026-12-11", hora: "09:30:00", abogadoId: responsable.id });

    // Solo un abogado activo asiste a una audiencia.
    expect((await send(titular, "PATCH", `/api/audiencias/${audiencia.id}`, { abogadoId: asistente.id })).statusCode).toBe(400);
    expect((await send(titular, "PATCH", `/api/audiencias/${audiencia.id}`, {})).statusCode).toBe(400);
    expect((await send(titular, "PATCH", `/api/audiencias/${audiencia.id}`, { estado: "realizada" })).statusCode).toBe(400);
    expect((await send(titular, "PATCH", "/api/audiencias/00000000-0000-7000-8000-000000000000", { hora: "12:00" })).statusCode).toBe(404);
  });

  it("solo los abogados activos asisten a audiencias nuevas", async () => {
    const { titular, asistente, send, carpeta } = await escenario();
    const res = await send(titular, "POST", "/api/audiencias", {
      carpetaId: carpeta.id, abogadoId: asistente.id, fecha: "2026-12-12", hora: "10:00", tipoAudienciaId: 1,
    });
    expect(res.statusCode).toBe(400);
  });

  it("el abogado común se ve solo a sí mismo en el equipo; quien asigna ve a todos", async () => {
    const { titular, responsable, asistente, send } = await escenario();
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, asistente.id));
    const otroAsistente = await seedUser(db, { email: `asistente-2-${Date.now()}@test.com`, role: "asistente" });

    const ids = async (who: { authHeader: string }, url = "/api/equipo") =>
      (await send(who, "GET", url)).json().map((m: { id: string }) => m.id);

    expect(await ids(responsable)).toEqual([responsable.id]);
    expect(await ids(otroAsistente)).toHaveLength(4);
    expect(await ids(titular)).not.toContain(asistente.id);
    expect(await ids(titular, "/api/equipo?incluirInactivos=true")).toContain(asistente.id);
    // Solo el titular puede pedir las bajas.
    expect(await ids(otroAsistente, "/api/equipo?incluirInactivos=true")).not.toContain(asistente.id);
  });

  it("solo el titular da de alta integrantes y la cuenta nueva entra con su perfil", async () => {
    const authAdmin = fakeAuthAdmin();
    const { titular, responsable, asistente, send } = await escenario(authAdmin);
    const alta = { email: "Nueva.Abogada@Test.com", password: "Inicial-2026", rol: "abogado" };

    expect((await send(responsable, "POST", "/api/equipo", alta)).statusCode).toBe(403);
    expect((await send(asistente, "POST", "/api/equipo", alta)).statusCode).toBe(403);
    expect((await send(titular, "POST", "/api/equipo", { ...alta, rol: "asistente", esTitular: true })).statusCode).toBe(400);
    expect((await send(titular, "POST", "/api/equipo", { ...alta, password: "corta" })).statusCode).toBe(400);
    expect(authAdmin.creadas).toEqual([]);

    const creada = await send(titular, "POST", "/api/equipo", alta);
    expect(creada.statusCode).toBe(201);
    expect(creada.json()).toMatchObject({ email: "nueva.abogada@test.com", rol: "abogado", esTitular: false, activo: true });
    expect(authAdmin.creadas).toEqual(["nueva.abogada@test.com"]);

    const [perfil] = await db.select().from(usuarios).where(eq(usuarios.email, "nueva.abogada@test.com"));
    const me = await send({ authHeader: `Bearer ${perfil.supabaseUserId}` }, "GET", "/api/auth/me");
    expect(me.json().user.perfil).toBe("abogado");

    expect((await send(titular, "POST", "/api/equipo", alta)).statusCode).toBe(409);
  });

  it("un abogado con carpetas a su cargo no pasa a asistente hasta que se las reasignen", async () => {
    const { titular, responsable, reemplazo, send, carpeta } = await escenario();

    const bloqueado = await send(titular, "PATCH", `/api/equipo/${responsable.id}`, { rol: "asistente" });
    expect(bloqueado.statusCode).toBe(409);

    const reasignada = await send(titular, "PATCH", `/api/carpetas/${carpeta.id}`, {
      version: carpeta.version,
      abogadoResponsableId: reemplazo.id,
    });
    expect(reasignada.statusCode).toBe(200);
    expect((await send(titular, "PATCH", `/api/equipo/${responsable.id}`, { rol: "asistente" })).statusCode).toBe(200);
  });

  it("el alta informa cuando el proveedor rechaza la cuenta o no está configurado", async () => {
    const rechaza = await escenario(fakeAuthAdmin(new AuthAdminError(409, "Ya existe una cuenta con ese email")));
    const alta = { email: `otra-${Date.now()}@test.com`, password: "Inicial-2026", rol: "asistente" };
    const res = await rechaza.send(rechaza.titular, "POST", "/api/equipo", alta);
    expect(res.statusCode).toBe(409);
    expect(await db.select().from(usuarios).where(eq(usuarios.email, alta.email))).toEqual([]);

    await resetDatabase(db);
    const sinConfigurar = await escenario(null);
    expect((await sinConfigurar.send(sinConfigurar.titular, "POST", "/api/equipo", alta)).statusCode).toBe(503);
  });
});
