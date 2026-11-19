import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  bitacoraCarpetas,
  carpetas,
  estadosActa,
  estadosCaso,
  sectores,
  tiposActa,
  usuarios,
} from "../../../packages/db/src/index.js";
import { buildApp } from "../src/app.js";
import { createTestDatabase, createTestSupabaseClient, resetDatabase, seedUser } from "./helpers/db.js";

/**
 * Matriz de permisos por perfil:
 *   - Titular (abogado + es_titular): ve y modifica todo, administra el equipo.
 *   - Abogado: solo sus carpetas y su agenda.
 *   - Asistente: ve todo, agenda y vincula actas; no abre ni edita carpetas.
 */
describe("permisos por perfil (titular, abogado, asistente)", async () => {
  const db = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function escenario() {
    const app = await buildApp({ db, environment: "test", supabase: createTestSupabaseClient() });
    const stamp = Date.now();
    const titular = await seedUser(db, { email: `titular-${stamp}@test.com` });
    const abogado = await seedUser(db, { email: `abogado-${stamp}@test.com`, role: "abogado", esTitular: false });
    const otroAbogado = await seedUser(db, { email: `otro-abogado-${stamp}@test.com`, role: "abogado", esTitular: false });
    const asistente = await seedUser(db, { email: `asistente-${stamp}@test.com`, role: "asistente" });

    const [sector] = await db.select().from(sectores).limit(1);
    const [enTramite] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "en_tramite"));

    const send = (
      who: { authHeader: string },
      method: "GET" | "POST" | "PATCH",
      url: string,
      payload?: object,
    ) => app.inject({ method, url, headers: { authorization: who.authHeader }, payload });

    let seq = 0;
    const carpetaPayload = (extra: object = {}) => ({
      sectorActualId: sector.id,
      estadoCasoId: enTramite.id,
      expediente: `PERFIL-${stamp}-${seq++}`,
      caratula: "Pérez c/ Empresa",
      demandada: "Empresa S.A.",
      ...extra,
    });

    const crearCarpeta = async (responsableId: string) => {
      const res = await send(titular, "POST", "/api/carpetas", carpetaPayload({ abogadoResponsableId: responsableId }));
      expect(res.statusCode).toBe(201);
      return res.json();
    };

    const propia = await crearCarpeta(abogado.id);
    const ajena = await crearCarpeta(otroAbogado.id);

    return { app, titular, abogado, otroAbogado, asistente, sector, enTramite, send, carpetaPayload, propia, ajena };
  }

  it("un abogado común solo ve sus carpetas; el titular y el asistente ven todas", async () => {
    const { titular, abogado, asistente, send, propia, ajena } = await escenario();

    const ids = async (who: { authHeader: string }) =>
      (await send(who, "GET", "/api/carpetas")).json().map((c: { id: string }) => c.id).sort();

    expect(await ids(abogado)).toEqual([propia.id]);
    expect(await ids(titular)).toEqual([propia.id, ajena.id].sort());
    expect(await ids(asistente)).toEqual([propia.id, ajena.id].sort());

    expect((await send(abogado, "GET", `/api/carpetas/${propia.id}`)).statusCode).toBe(200);
    expect((await send(abogado, "GET", `/api/carpetas/${ajena.id}`)).statusCode).toBe(403);
    expect((await send(abogado, "GET", `/api/carpetas/${ajena.id}/bitacora`)).statusCode).toBe(403);
    expect((await send(abogado, "GET", `/api/carpetas/${ajena.id}/audiencias`)).statusCode).toBe(403);
    expect((await send(asistente, "GET", `/api/carpetas/${ajena.id}/bitacora`)).statusCode).toBe(200);
  });

  it("aplica los chequeos en orden: 401, rol 403, cuerpo 400, existencia 404, recurso 403", async () => {
    const { app, abogado, asistente, send, ajena } = await escenario();
    const sinRol = await seedUser(db, { email: `sin-rol-${Date.now()}@test.com`, role: null });

    expect((await app.inject({ method: "GET", url: "/api/carpetas" })).statusCode).toBe(401);
    expect((await send(sinRol, "GET", "/api/carpetas")).statusCode).toBe(403);
    // El asistente no abre carpetas: 403 por rol antes de validar el cuerpo.
    expect((await send(asistente, "POST", "/api/carpetas", {})).statusCode).toBe(403);
    expect((await send(abogado, "POST", "/api/carpetas", {})).statusCode).toBe(400);
    expect((await send(abogado, "PATCH", "/api/carpetas/00000000-0000-7000-8000-000000000000", { version: 1 })).statusCode).toBe(404);
    expect((await send(abogado, "PATCH", `/api/carpetas/${ajena.id}`, { version: 1 })).statusCode).toBe(403);
  });

  it("solo los abogados abren carpetas y quien la abre queda como responsable", async () => {
    const { titular, abogado, otroAbogado, asistente, send, carpetaPayload } = await escenario();

    const propia = await send(abogado, "POST", "/api/carpetas", carpetaPayload());
    expect(propia.statusCode).toBe(201);
    expect(propia.json().abogadoResponsableId).toBe(abogado.id);

    expect((await send(asistente, "POST", "/api/carpetas", carpetaPayload())).statusCode).toBe(403);
    expect((await send(abogado, "POST", "/api/carpetas", carpetaPayload({ abogadoResponsableId: otroAbogado.id }))).statusCode).toBe(403);
    expect((await send(titular, "POST", "/api/carpetas", carpetaPayload({ abogadoResponsableId: asistente.id }))).statusCode).toBe(400);

    const asignada = await send(titular, "POST", "/api/carpetas", carpetaPayload({ abogadoResponsableId: otroAbogado.id }));
    expect(asignada.statusCode).toBe(201);
    expect(asignada.json().abogadoResponsableId).toBe(otroAbogado.id);
  });

  it("la carpeta la modifican el titular y su abogado responsable, no el asistente ni otro abogado", async () => {
    const { titular, abogado, otroAbogado, asistente, send, propia } = await escenario();
    const [otroSector] = await db.select().from(sectores).where(eq(sectores.codigo, "procesal"));

    const delResponsable = await send(abogado, "PATCH", `/api/carpetas/${propia.id}`, {
      version: propia.version,
      sectorActualId: otroSector.id,
    });
    expect(delResponsable.statusCode).toBe(200);
    expect(delResponsable.json().sectorActualId).toBe(otroSector.id);

    const version = delResponsable.json().version;
    expect((await send(otroAbogado, "PATCH", `/api/carpetas/${propia.id}`, { version, caratula: "x" })).statusCode).toBe(403);
    expect((await send(asistente, "PATCH", `/api/carpetas/${propia.id}`, { version, caratula: "x" })).statusCode).toBe(403);

    const delTitular = await send(titular, "PATCH", `/api/carpetas/${propia.id}`, { version, caratula: "Pérez c/ Empresa S.A." });
    expect(delTitular.statusCode).toBe(200);
    expect(delTitular.json().version).toBe(version + 1);
  });

  it("solo el titular reasigna una carpeta a otro abogado", async () => {
    const { titular, abogado, otroAbogado, send, propia } = await escenario();

    const intento = await send(abogado, "PATCH", `/api/carpetas/${propia.id}`, {
      version: propia.version,
      abogadoResponsableId: otroAbogado.id,
    });
    expect(intento.statusCode).toBe(403);

    const reasignada = await send(titular, "PATCH", `/api/carpetas/${propia.id}`, {
      version: propia.version,
      abogadoResponsableId: otroAbogado.id,
    });
    expect(reasignada.statusCode).toBe(200);
    expect(reasignada.json().abogadoResponsableId).toBe(otroAbogado.id);

    // El abogado anterior deja de verla en el siguiente pedido.
    expect((await send(abogado, "GET", `/api/carpetas/${propia.id}`)).statusCode).toBe(403);
    expect((await send(otroAbogado, "GET", `/api/carpetas/${propia.id}`)).statusCode).toBe(200);
  });

  it("la agenda del abogado común muestra sus audiencias y las de sus carpetas", async () => {
    const { titular, abogado, otroAbogado, asistente, send, propia, ajena } = await escenario();
    const fecha = "2026-12-01";
    const agendar = async (carpetaId: string | null, abogadoId: string, hora: string) => {
      const res = await send(titular, "POST", "/api/audiencias", { carpetaId, abogadoId, fecha, hora, tipoAudienciaId: 1 });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    };

    const enSuCarpeta = await agendar(propia.id, titular.id, "09:00");
    const enCarpetaAjena = await agendar(ajena.id, otroAbogado.id, "10:00");
    const sinCarpetaDelOtro = await agendar(null, otroAbogado.id, "11:00");

    const agenda = async (who: { authHeader: string }) =>
      (await send(who, "GET", `/api/audiencias?fecha=${fecha}`)).json().map((a: { id: string }) => a.id).sort();
    const sinCarpeta = async (who: { authHeader: string }) =>
      (await send(who, "GET", "/api/audiencias/orphan")).json().map((a: { id: string }) => a.id);

    expect(await agenda(abogado)).toEqual([enSuCarpeta]);
    expect(await agenda(otroAbogado)).toEqual([enCarpetaAjena, sinCarpetaDelOtro].sort());
    expect(await agenda(asistente)).toEqual([enSuCarpeta, enCarpetaAjena, sinCarpetaDelOtro].sort());
    expect(await sinCarpeta(abogado)).toEqual([]);
    expect(await sinCarpeta(otroAbogado)).toEqual([sinCarpetaDelOtro]);
    expect(await sinCarpeta(asistente)).toEqual([sinCarpetaDelOtro]);
  });

  it("el abogado común agenda solo para sí y en sus carpetas; el asistente agenda en cualquiera", async () => {
    const { abogado, otroAbogado, asistente, send, propia, ajena } = await escenario();
    const audiencia = (carpetaId: string | null, abogadoId: string) => ({
      carpetaId, abogadoId, fecha: "2026-12-02", hora: "09:00", tipoAudienciaId: 1,
    });

    expect((await send(abogado, "POST", "/api/audiencias", audiencia(null, otroAbogado.id))).statusCode).toBe(403);
    expect((await send(abogado, "POST", "/api/audiencias", audiencia(ajena.id, abogado.id))).statusCode).toBe(403);
    expect((await send(abogado, "POST", "/api/audiencias", audiencia(propia.id, abogado.id))).statusCode).toBe(201);
    expect((await send(asistente, "POST", "/api/audiencias", audiencia(ajena.id, otroAbogado.id))).statusCode).toBe(201);
  });

  it("el asistente vincula actas en cualquier carpeta; un abogado común, solo en las suyas", async () => {
    const { abogado, otroAbogado, asistente, send, ajena } = await escenario();
    const [acuerdo] = await db.select().from(tiposActa).where(eq(tiposActa.codigo, "acuerdo"));
    const [pendiente] = await db.select().from(estadosActa).where(eq(estadosActa.codigo, "pendiente"));

    const preparar = async () => {
      const audiencia = await send(asistente, "POST", "/api/audiencias", {
        carpetaId: ajena.id, abogadoId: otroAbogado.id, fecha: "2026-12-03", hora: "09:00", tipoAudienciaId: 1,
      });
      const acta = await send(asistente, "POST", "/api/actas", { tipoActaId: acuerdo.id, estadoActaId: pendiente.id });
      expect(audiencia.statusCode).toBe(201);
      expect(acta.statusCode).toBe(201);
      return { audienciaId: audiencia.json().id, actaId: acta.json().id };
    };

    const primera = await preparar();
    const denegada = await send(abogado, "PATCH", `/api/actas/${primera.actaId}/vincular`, {
      carpetaId: ajena.id, audienciaId: primera.audienciaId,
    });
    expect(denegada.statusCode).toBe(403);

    const vinculada = await send(asistente, "PATCH", `/api/actas/${primera.actaId}/vincular`, {
      carpetaId: ajena.id, audienciaId: primera.audienciaId,
    });
    expect(vinculada.statusCode).toBe(200);
    const [carpeta] = await db.select().from(carpetas).where(eq(carpetas.id, ajena.id));
    const [conciliado] = await db.select().from(estadosCaso).where(eq(estadosCaso.codigo, "conciliado"));
    expect(carpeta.estadoCasoId).toBe(conciliado.id);
    expect(carpeta.version).toBe(ajena.version + 1);

    // La bitácora atribuye el cambio de estado al asistente que vinculó el acta.
    const [entrada] = await db
      .select()
      .from(bitacoraCarpetas)
      .where(and(eq(bitacoraCarpetas.carpetaId, ajena.id), eq(bitacoraCarpetas.accionRealizada, "acta_vinculada")));
    expect(entrada.usuarioId).toBe(asistente.id);
    expect(entrada.metadata).toMatchObject({ estado_anterior: "en_tramite", estado_nuevo: "conciliado" });
  });

  it("un cambio de rol o de titularidad aplica en el siguiente pedido", async () => {
    const { abogado, send, ajena } = await escenario();

    expect((await send(abogado, "GET", `/api/carpetas/${ajena.id}`)).statusCode).toBe(403);
    await db.update(usuarios).set({ esTitular: true }).where(eq(usuarios.id, abogado.id));
    expect((await send(abogado, "GET", `/api/carpetas/${ajena.id}`)).statusCode).toBe(200);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, abogado.id));
    expect((await send(abogado, "GET", `/api/carpetas/${ajena.id}`)).statusCode).toBe(403);
  });

  it("solo el titular administra el equipo y el estudio nunca queda sin titular", async () => {
    const { titular, abogado, asistente, send } = await escenario();

    const equipo = (await send(asistente, "GET", "/api/equipo")).json();
    expect(equipo.find((m: { id: string }) => m.id === titular.id)).toMatchObject({ rol: "abogado", esTitular: true });
    expect(equipo.find((m: { id: string }) => m.id === asistente.id)).toMatchObject({ rol: "asistente", esTitular: false });

    expect((await send(abogado, "PATCH", `/api/equipo/${asistente.id}`, { rol: "abogado" })).statusCode).toBe(403);
    expect((await send(asistente, "PATCH", `/api/equipo/${asistente.id}`, { rol: "abogado" })).statusCode).toBe(403);
    expect((await send(titular, "PATCH", `/api/equipo/${asistente.id}`, { esTitular: true })).statusCode).toBe(400);
    expect((await send(titular, "PATCH", `/api/equipo/${titular.id}`, { esTitular: false })).statusCode).toBe(409);

    const promovido = await send(titular, "PATCH", `/api/equipo/${abogado.id}`, { esTitular: true });
    expect(promovido.statusCode).toBe(200);
    expect(promovido.json()).toMatchObject({ rol: "abogado", esTitular: true });

    // Con dos titulares, uno puede dejar de serlo.
    expect((await send(titular, "PATCH", `/api/equipo/${titular.id}`, { esTitular: false })).statusCode).toBe(200);

    const ascendido = await send(abogado, "PATCH", `/api/equipo/${asistente.id}`, { rol: "abogado" });
    expect(ascendido.statusCode).toBe(200);
    expect(ascendido.json()).toMatchObject({ rol: "abogado", esTitular: false });
  });

  it("GET /api/auth/me informa el perfil resuelto", async () => {
    const { titular, abogado, asistente, send } = await escenario();
    const sinRol = await seedUser(db, { email: `me-sin-rol-${Date.now()}@test.com`, role: null });

    const perfil = async (who: { authHeader: string }) => (await send(who, "GET", "/api/auth/me")).json().user.perfil;
    expect(await perfil(titular)).toBe("titular");
    expect(await perfil(abogado)).toBe("abogado");
    expect(await perfil(asistente)).toBe("asistente");
    expect(await perfil(sinRol)).toBeNull();
  });
});
