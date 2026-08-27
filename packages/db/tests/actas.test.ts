import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  actas,
  createDatabase,
  estadosActa,
  estudios,
  runMigrations,
  tiposActa,
} from "../src/index.js";

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://sechub:sechub@localhost:5432/sechub";
}

describe("actas schema", () => {
  it("seeds catalogs and allows orphan actas with duplicate expediente", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const tipos = await db.select().from(tiposActa).orderBy(tiposActa.id);
    const estados = await db.select().from(estadosActa).orderBy(estadosActa.id);

    expect(tipos.map((tipo) => tipo.codigo)).toEqual([
      "audiencia_conciliatoria",
      "pase_segunda_fecha",
      "acuerdo",
      "desistimiento",
    ]);
    expect(estados.map((estado) => estado.codigo)).toEqual([
      "pendiente",
      "firmada",
      "archivada",
    ]);

    const [tipo] = tipos;
    const [estado] = estados;
    const expediente = `ACTA-DUP-${Date.now()}`;
    const [first, second] = await db
      .insert(actas)
      .values([
        {
          estudioId: estudio.id,
          expediente,
          tipoActaId: tipo.id,
          estadoActaId: estado.id,
          fecha: "2026-01-01",
        },
        {
          estudioId: estudio.id,
          expediente,
          tipoActaId: tipo.id,
          estadoActaId: estado.id,
          fecha: "2026-01-02",
        },
      ])
      .returning();

    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first.carpetaId).toBeNull();
    expect(second.expediente).toBe(expediente);

    const indexes = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'actas'
    `);
    const indexNames = (indexes.rows as Array<{ indexname: string }>).map((row) => row.indexname);
    expect(indexNames).toContain("actas_estudio_carpeta_idx");
    expect(indexNames).toContain("actas_expediente_idx");
    expect(indexNames).toContain("actas_estudio_expediente_idx");
    expect(indexNames).toContain("actas_estudio_tipo_estado_idx");

    const constraints = await db.execute(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'actas'::regclass
        AND contype = 'f'
    `);
    const constraintNames = (constraints.rows as Array<{ conname: string }>).map((row) => row.conname);
    expect(constraintNames).toEqual(expect.arrayContaining([
      "actas_estudio_id_estudios_id_fk",
      "actas_carpeta_id_carpetas_id_fk",
      "actas_tipo_acta_id_tipos_acta_id_fk",
      "actas_estado_acta_id_estados_acta_id_fk",
    ]));

    await expect(db.insert(actas).values({
      estudioId: "00000000-0000-0000-0000-000000000000",
      tipoActaId: tipo.id,
      estadoActaId: estado.id,
    })).rejects.toBeDefined();
  });
});
