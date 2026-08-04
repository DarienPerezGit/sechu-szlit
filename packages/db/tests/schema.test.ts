import { describe, expect, it } from "vitest";
import { createDatabase, runMigrations, estudios } from "../src/index.js";

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://sechub:sechub@localhost:5432/sechub"
  );
}

describe("database schema", () => {
  it("seeds one estudio on migrate", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const rows = await db.select().from(estudios);
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe("Estudio Szlit");
  });

  it("generates estudios id as a valid uuid", async () => {
    const db = createDatabase(getDatabaseUrl());
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios);
    expect(estudio.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
