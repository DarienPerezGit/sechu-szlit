import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, runMigrations, estudios, sectores, estadosCaso, usuarios, carpetas, bitacoraCarpetas } from "../src/index.js";

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://sechub:sechub@localhost:5432/sechub"
  );
}

describe("carpetas and bitacora schema", () => {
  it("creates a carpeta and inserts into bitacora in a transaction", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);

    // Create a user first for bitacora
    const [usuario] = await db.insert(usuarios).values({
      email: `test-bitacora-${Date.now()}@test.com`,
      estudioId: estudio.id,
    }).returning();

    const uniqueExpediente = `EXP-${Date.now()}`;

    // Perform transaction
    const result = await db.transaction(async (tx) => {
      const [carpeta] = await tx.insert(carpetas).values({
        estudioId: estudio.id,
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: uniqueExpediente,
        caratula: "Pérez c/ Empresa",
        demandada: "Empresa S.A.",
      }).returning();

      const [bitacora] = await tx.insert(bitacoraCarpetas).values({
        carpetaId: carpeta.id,
        usuarioId: usuario.id,
        accionRealizada: "Carpeta creada manualmente",
        metadata: { source: "test" },
      }).returning();

      return { carpeta, bitacora };
    });

    expect(result.carpeta.id).toBeDefined();
    expect(result.carpeta.version).toBe(1);
    expect(result.carpeta.expediente).toBe(uniqueExpediente);
    expect(result.bitacora.id).toBeDefined();
    expect(result.bitacora.carpetaId).toBe(result.carpeta.id);
    expect(result.bitacora.usuarioId).toBe(usuario.id);
    expect(result.bitacora.accionRealizada).toBe("Carpeta creada manualmente");
  });

  it("enforces optimistic locking on updates", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);

    const uniqueExpediente = `EXP-OPT-${Date.now()}`;
    const [carpeta] = await db.insert(carpetas).values({
      estudioId: estudio.id,
      sectorActualId: sector.id,
      estadoCasoId: estado.id,
      expediente: uniqueExpediente,
      caratula: "González c/ Todo",
      demandada: "Todo S.R.L.",
    }).returning();

    expect(carpeta.version).toBe(1);

    // First update succeeds (version matches 1)
    const update1 = await db.update(carpetas)
      .set({
        caratula: "González c/ Todo S.R.L.",
        version: carpeta.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(carpetas.id, carpeta.id), eq(carpetas.version, carpeta.version)))
      .returning();

    expect(update1).toHaveLength(1);
    expect(update1[0].version).toBe(2);
    expect(update1[0].caratula).toBe("González c/ Todo S.R.L.");

    // Second update with stale version (using original version = 1) fails
    const update2 = await db.update(carpetas)
      .set({
        caratula: "González c/ Todo S.R.L. Modificado",
        version: carpeta.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(carpetas.id, carpeta.id), eq(carpetas.version, carpeta.version)))
      .returning();

    expect(update2).toHaveLength(0); // No rows updated because of optimistic lock version mismatch
  });
});
