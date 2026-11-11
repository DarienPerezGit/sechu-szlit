import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createTestDatabase, createTestSupabaseClient } from "./helpers/db.js";
import { sectores, estadosCaso, tiposAudiencia, type Database } from "@sechub/db";
import { eq } from "drizzle-orm";

// After each test, re-activate every catalog row. Tests below flip `activo`
// to false to assert the endpoint filter; if a run is interrupted mid-test,
// a persistent test DB would otherwise keep those rows deactivated and
// break subsequent runs. This afterEach makes the suite self-healing.
async function reactivateAll(db: Database) {
  await Promise.all([
    db.update(sectores).set({ activo: true }),
    db.update(estadosCaso).set({ activo: true }),
    db.update(tiposAudiencia).set({ activo: true }),
  ]);
}

describe("catalogos API", async () => {
  const db = await createTestDatabase();

  // Ensure seed rows are active before any test in this file runs, and
  // restore them after every test so the shared DB never drifts.
  await reactivateAll(db);
  afterEach(() => reactivateAll(db));

  async function createApp() {
    return buildApp({
      db,
      environment: "test",
      supabase: createTestSupabaseClient(),
    });
  }

  it("serves GET /api/sectores returning only active sectors in order", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/sectores",
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.length).toBeGreaterThanOrEqual(6);

    // Verify ordering by ordenPipeline (Comunicaciones first: 1, then SECLO: 2, etc. Verticals with null at the end)
    const activeSectores = data.filter((s: any) => s.activo === true);
    expect(activeSectores.length).toBe(data.length); // All should be active

    const comunicaciones = data.find((s: any) => s.codigo === "comunicaciones");
    expect(comunicaciones).toBeDefined();
    expect(comunicaciones.ordenPipeline).toBe(1);
    expect(comunicaciones.esVertical).toBe(false);

    const accidentes = data.find((s: any) => s.codigo === "accidentes");
    expect(accidentes).toBeDefined();
    expect(accidentes.ordenPipeline).toBeNull();
    expect(accidentes.esVertical).toBe(true);

    // Check that we can temporarily deactivate one and it won't be returned
    await db.update(sectores).set({ activo: false }).where(eq(sectores.codigo, "redaccion"));
    try {
      const response2 = await app.inject({
        method: "GET",
        url: "/api/sectores",
      });
      const data2 = response2.json();
      expect(data2.find((s: any) => s.codigo === "redaccion")).toBeUndefined();
    } finally {
      // Restore active state
      await db.update(sectores).set({ activo: true }).where(eq(sectores.codigo, "redaccion"));
    }
  });

  it("serves GET /api/estados-caso returning only active states", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/estados-caso",
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.length).toBeGreaterThanOrEqual(4);

    const enTramite = data.find((e: any) => e.codigo === "en_tramite");
    expect(enTramite).toBeDefined();
    expect(enTramite.nombre).toBe("En trámite");

    // Check deactivation filter
    await db.update(estadosCaso).set({ activo: false }).where(eq(estadosCaso.codigo, "conciliado"));
    try {
      const response2 = await app.inject({
        method: "GET",
        url: "/api/estados-caso",
      });
      const data2 = response2.json();
      expect(data2.find((e: any) => e.codigo === "conciliado")).toBeUndefined();
    } finally {
      await db.update(estadosCaso).set({ activo: true }).where(eq(estadosCaso.codigo, "conciliado"));
    }
  });

  it("serves GET /api/tipos-audiencia returning only active types with color", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/tipos-audiencia",
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.length).toBeGreaterThanOrEqual(6);

    const seclo = data.find((t: any) => t.codigo === "seclo");
    expect(seclo).toBeDefined();
    expect(seclo.color).toBeDefined();

    // Check deactivation filter
    await db.update(tiposAudiencia).set({ activo: false }).where(eq(tiposAudiencia.codigo, "consulta"));
    try {
      const response2 = await app.inject({
        method: "GET",
        url: "/api/tipos-audiencia",
      });
      const data2 = response2.json();
      expect(data2.find((t: any) => t.codigo === "consulta")).toBeUndefined();
    } finally {
      await db.update(tiposAudiencia).set({ activo: true }).where(eq(tiposAudiencia.codigo, "consulta"));
    }
  });
});
