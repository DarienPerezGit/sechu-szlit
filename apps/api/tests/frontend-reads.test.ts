import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { estadosCaso, sectores, tiposAudiencia, type Database } from "@sechub/db";
import { buildApp } from "../src/app.js";
import {
  createTestDatabase,
  createTestSupabaseClient,
  resetDatabase,
  seedUser,
} from "./helpers/db.js";

/** Read endpoints added for the domain frontend (#11). */
describe("frontend read endpoints", async () => {
  const db: Database = await createTestDatabase();

  beforeEach(async () => {
    await resetDatabase(db);
  });

  const createApp = () =>
    buildApp({ db, environment: "test", supabase: createTestSupabaseClient() });

  async function seedCarpetaConAudiencia() {
    const app = await createApp();
    const user = await seedUser(db);
    const auth = { authorization: user.authHeader };
    const [sector] = await db.select().from(sectores).where(eq(sectores.activo, true)).limit(1);
    const [estado] = await db.select().from(estadosCaso).where(eq(estadosCaso.activo, true)).limit(1);
    const [tipo] = await db.select().from(tiposAudiencia).where(eq(tiposAudiencia.activo, true)).limit(1);

    const carpeta = (
      await app.inject({
        method: "POST",
        url: "/api/carpetas",
        headers: auth,
        payload: {
          sectorActualId: sector.id,
          estadoCasoId: estado.id,
          expediente: `EXP-FR-${Date.now()}`,
          caratula: "Gómez c/ Acme",
          demandada: "Acme S.A.",
        },
      })
    ).json();

    for (const fecha of ["2026-11-20", "2026-12-15"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/audiencias",
        headers: auth,
        payload: { carpetaId: carpeta.id, abogadoId: user.id, fecha, hora: "10:00", tipoAudienciaId: tipo.id },
      });
      expect(res.statusCode).toBe(201);
    }
    return { app, user, auth, carpeta };
  }

  it("lists a carpeta's audiencias and bitácora", async () => {
    const { app, user, auth, carpeta } = await seedCarpetaConAudiencia();

    const aud = await app.inject({ method: "GET", url: `/api/carpetas/${carpeta.id}/audiencias`, headers: auth });
    expect(aud.statusCode).toBe(200);
    expect(aud.json().map((a: { fecha: string }) => a.fecha)).toEqual(["2026-11-20", "2026-12-15"]);
    expect(aud.json()[0]).toMatchObject({ estado: "pendiente", abogadoEmail: user.email });

    const bit = await app.inject({ method: "GET", url: `/api/carpetas/${carpeta.id}/bitacora`, headers: auth });
    expect(bit.statusCode).toBe(200);
    expect(bit.json().length).toBeGreaterThan(0);
    expect(bit.json().at(-1)).toMatchObject({ accionRealizada: "Carpeta creada manualmente", usuarioEmail: user.email });
  });

  it("rejects unknown or malformed carpeta ids", async () => {
    const { app, auth } = await seedCarpetaConAudiencia();
    const missing = await app.inject({
      method: "GET",
      url: "/api/carpetas/00000000-0000-0000-0000-000000000000/bitacora",
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: "GET", url: "/api/carpetas/nope/audiencias", headers: auth });
    expect(bad.statusCode).toBe(400);
  });

  it("returns audiencias in a date range and validates it", async () => {
    const { app, auth } = await seedCarpetaConAudiencia();

    const nov = await app.inject({
      method: "GET",
      url: "/api/audiencias?desde=2026-11-01&hasta=2026-11-30",
      headers: auth,
    });
    expect(nov.statusCode).toBe(200);
    expect(nov.json()).toHaveLength(1);
    expect(nov.json()[0]).toMatchObject({ fecha: "2026-11-20", estado: "pendiente", caratula: "Gómez c/ Acme" });

    const tooWide = await app.inject({
      method: "GET",
      url: "/api/audiencias?desde=2026-01-01&hasta=2026-12-31",
      headers: auth,
    });
    expect(tooWide.statusCode).toBe(400);

    const inverted = await app.inject({
      method: "GET",
      url: "/api/audiencias?desde=2026-12-01&hasta=2026-11-01",
      headers: auth,
    });
    expect(inverted.statusCode).toBe(400);
  });

  it("lists active team members with id and email only", async () => {
    const app = await createApp();
    const admin = await seedUser(db);
    await seedUser(db, { email: "inactivo@estudioszlit.com.ar", activo: false });

    const res = await app.inject({ method: "GET", url: "/api/equipo", headers: { authorization: admin.authHeader } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: admin.id, email: admin.email }]);

    const anon = await app.inject({ method: "GET", url: "/api/equipo" });
    expect(anon.statusCode).toBe(401);
  });
});
