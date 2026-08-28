import { describe, expect, it } from "vitest";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  createDatabase,
  runMigrations,
  estudios,
  sectores,
  estadosCaso,
  usuarios,
  carpetas,
  bitacoraCarpetas,
  tiposAudiencia,
  audiencias,
} from "../src/index.js";

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://sechub:sechub@localhost:5432/sechub"
  );
}

describe("audiencias schema", () => {
  it("creates an audiencia linked to a carpeta", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    // Create a lawyer user
    const [abogado] = await db
      .insert(usuarios)
      .values({
        email: `test-aud-${Date.now()}@test.com`,
        passwordHash: "fake-hash",
        estudioId: estudio.id,
      })
      .returning();

    // Create a carpeta
    const uniqueExpediente = `EXP-AUD-${Date.now()}`;
    const [carpeta] = await db
      .insert(carpetas)
      .values({
        estudioId: estudio.id,
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: uniqueExpediente,
        caratula: "Caso con audiencia",
        demandada: "Demandada S.A.",
      })
      .returning();

    // Create audiencia
    const [audiencia] = await db
      .insert(audiencias)
      .values({
        estudioId: estudio.id,
        carpetaId: carpeta.id,
        abogadoId: abogado.id,
        fecha: "2026-08-10",
        hora: "10:30:00",
        tipoAudienciaId: tipo.id,
        linkReunion: "https://meet.example.com/abc",
        notasInternas: "Llevar documentación del caso",
      })
      .returning();

    expect(audiencia.id).toBeDefined();
    expect(audiencia.estudioId).toBe(estudio.id);
    expect(audiencia.carpetaId).toBe(carpeta.id);
    expect(audiencia.abogadoId).toBe(abogado.id);
    expect(audiencia.fecha).toBe("2026-08-10");
    expect(audiencia.hora).toBe("10:30:00");
    expect(audiencia.tipoAudienciaId).toBe(tipo.id);
    expect(audiencia.linkReunion).toBe("https://meet.example.com/abc");
    expect(audiencia.notasInternas).toBe("Llevar documentación del caso");
    expect(audiencia.createdAt).toBeDefined();
    expect(audiencia.updatedAt).toBeDefined();
  });

  it("creates an audiencia without carpeta (orphan)", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    // Clean up residual audiencias from previous runs on shared DB
    await db.delete(audiencias);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    const [abogado] = await db
      .insert(usuarios)
      .values({
        email: `test-orphan-${Date.now()}@test.com`,
        passwordHash: "fake-hash",
        estudioId: estudio.id,
      })
      .returning();

    const [audiencia] = await db
      .insert(audiencias)
      .values({
        estudioId: estudio.id,
        abogadoId: abogado.id,
        fecha: "2026-08-11",
        hora: "14:00:00",
        tipoAudienciaId: tipo.id,
      })
      .returning();

    expect(audiencia.id).toBeDefined();
    expect(audiencia.carpetaId).toBeNull();
    expect(audiencia.fecha).toBe("2026-08-11");

    // Verify it appears in orphan tray query
    const orphans = await db
      .select()
      .from(audiencias)
      .where(
        and(
          eq(audiencias.estudioId, estudio.id),
          isNull(audiencias.carpetaId),
        ),
      );

    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe(audiencia.id);
  });

  it("enforces foreign key constraints", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);

    // Insert with non-existent tipo_audiencia_id should fail
    await expect(
      db.insert(audiencias).values({
        estudioId: estudio.id,
        abogadoId: "00000000-0000-0000-0000-000000000000",
        fecha: "2026-08-12",
        hora: "09:00:00",
        tipoAudienciaId: 9999,
      }),
    ).rejects.toThrow();
  });

  it("queries agenda by estudio, fecha ordered by hora", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    const [abogado] = await db
      .insert(usuarios)
      .values({
        email: `test-agenda-${Date.now()}@test.com`,
        passwordHash: "fake-hash",
        estudioId: estudio.id,
      })
      .returning();

    // Insert two audiencias on the same day, different times
    await db.insert(audiencias).values({
      estudioId: estudio.id,
      abogadoId: abogado.id,
      fecha: "2026-08-15",
      hora: "15:00:00",
      tipoAudienciaId: tipo.id,
    });

    await db.insert(audiencias).values({
      estudioId: estudio.id,
      abogadoId: abogado.id,
      fecha: "2026-08-15",
      hora: "09:30:00",
      tipoAudienciaId: tipo.id,
    });

    const agenda = await db
      .select()
      .from(audiencias)
      .where(
        and(
          eq(audiencias.estudioId, estudio.id),
          eq(audiencias.fecha, "2026-08-15"),
        ),
      )
      .orderBy(audiencias.hora);

    expect(agenda).toHaveLength(2);
    expect(agenda[0].hora).toBe("09:30:00");
    expect(agenda[1].hora).toBe("15:00:00");
  });

  it("links an orphan audiencia to a carpeta in a transaction with bitacora", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [estado] = await db.select().from(estadosCaso).limit(1);
    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .limit(1);

    const [abogado] = await db
      .insert(usuarios)
      .values({
        email: `test-link-${Date.now()}@test.com`,
        passwordHash: "fake-hash",
        estudioId: estudio.id,
      })
      .returning();

    // Create orphan audiencia
    const [orphan] = await db
      .insert(audiencias)
      .values({
        estudioId: estudio.id,
        abogadoId: abogado.id,
        fecha: "2026-08-20",
        hora: "11:00:00",
        tipoAudienciaId: tipo.id,
      })
      .returning();

    expect(orphan.carpetaId).toBeNull();

    // Create a carpeta to link to
    const uniqueExpediente = `EXP-LINK-${Date.now()}`;
    const [carpeta] = await db
      .insert(carpetas)
      .values({
        estudioId: estudio.id,
        sectorActualId: sector.id,
        estadoCasoId: estado.id,
        expediente: uniqueExpediente,
        caratula: "Caso para vincular",
        demandada: "Demandada Link S.A.",
      })
      .returning();

    // Link orphan to carpeta in a transaction with bitacora
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(audiencias)
        .set({ carpetaId: carpeta.id, updatedAt: new Date() })
        .where(
          and(
            eq(audiencias.id, orphan.id),
            eq(audiencias.estudioId, estudio.id),
            isNull(audiencias.carpetaId),
          ),
        )
        .returning();

      if (!updated) throw new Error("Link failed");

      await tx.insert(bitacoraCarpetas).values({
        carpetaId: carpeta.id,
        usuarioId: abogado.id,
        accionRealizada: "audiencia_vinculada",
        metadata: { audienciaId: orphan.id },
      });

      return updated;
    });

    expect(result.carpetaId).toBe(carpeta.id);

    // Verify bitacora entry
    const bitacoraEntries = await db
      .select()
      .from(bitacoraCarpetas)
      .where(eq(bitacoraCarpetas.carpetaId, carpeta.id));

    const vinculacionEntry = bitacoraEntries.find(
      (e) => e.accionRealizada === "audiencia_vinculada",
    );
    expect(vinculacionEntry).toBeDefined();
    expect(vinculacionEntry?.metadata).toMatchObject({ audienciaId: orphan.id });
  });
});
