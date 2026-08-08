import { describe, expect, it } from "vitest";
import { createDatabase, runMigrations } from "../src/index.js";
import { sectores, estadosCaso, tiposAudiencia } from "../src/schema/catalogos.js";

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://sechub:sechub@localhost:5432/sechub"
  );
}

describe("catálogos schema & seed data", () => {
  it("seeds correct database elements idempotently", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    // 1. Sectores seed validation
    const rowsSectores = await db.select().from(sectores).orderBy(sectores.id);
    expect(rowsSectores.length).toBeGreaterThanOrEqual(6);

    const comunicaciones = rowsSectores.find(s => s.codigo === "comunicaciones");
    expect(comunicaciones).toBeDefined();
    expect(comunicaciones?.ordenPipeline).toBe(1);
    expect(comunicaciones?.esVertical).toBe(false);
    expect(comunicaciones?.activo).toBe(true);

    const accidentes = rowsSectores.find(s => s.codigo === "accidentes");
    expect(accidentes).toBeDefined();
    expect(accidentes?.ordenPipeline).toBeNull();
    expect(accidentes?.esVertical).toBe(true);
    expect(accidentes?.activo).toBe(true);

    // 2. Estados Caso seed validation
    const rowsEstados = await db.select().from(estadosCaso).orderBy(estadosCaso.id);
    expect(rowsEstados.length).toBeGreaterThanOrEqual(4);
    const enTramite = rowsEstados.find(e => e.codigo === "en_tramite");
    expect(enTramite).toBeDefined();
    expect(enTramite?.nombre).toBe("En trámite");

    // 3. Tipos Audiencia seed validation
    const rowsAudiencias = await db.select().from(tiposAudiencia).orderBy(tiposAudiencia.id);
    expect(rowsAudiencias.length).toBeGreaterThanOrEqual(6);
    const seclo = rowsAudiencias.find(a => a.codigo === "seclo");
    expect(seclo).toBeDefined();

    // 4. Test code uniqueness
    await expect(
      db.insert(sectores).values({
        codigo: "comunicaciones",
        nombre: "Comunicaciones Duplicado",
      })
    ).rejects.toThrow();

    await expect(
      db.insert(estadosCaso).values({
        codigo: "en_tramite",
        nombre: "En trámite Duplicado",
      })
    ).rejects.toThrow();

    await expect(
      db.insert(tiposAudiencia).values({
        codigo: "seclo",
        nombre: "SECLO Duplicado",
      })
    ).rejects.toThrow();
  });
});
