import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDatabase,
  runMigrations,
  estudios,
  roles,
  sectores,
  usuarios,
  usuariosRoles,
  usuariosSectores,
} from "../src/index.js";

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://sechub:sechub@localhost:5432/sechub"
  );
}

describe("roles schema", () => {
  const db = createDatabase(getDatabaseUrl());
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(usuariosRoles).where(eq(usuariosRoles.usuarioId, userId));
      await db.delete(usuariosSectores).where(eq(usuariosSectores.usuarioId, userId));
      await db.delete(usuarios).where(eq(usuarios.id, userId));
    }
  });

  it("seeds the required roles idempotently", async () => {
    await runMigrations(db);
    await runMigrations(db);

    const seededRoles = await db.select().from(roles);
    expect(seededRoles.map((role) => role.codigo)).toEqual(
      expect.arrayContaining(["admin", "responsable_sector", "lectura"]),
    );
  });

  it("rejects user-sector assignments for nonexistent sectors", async () => {
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [user] = await db.insert(usuarios).values({
      email: `roles-missing-sector-${Date.now()}@test.com`,
      estudioId: estudio.id,
    }).returning();
    createdUserIds.push(user.id);

    await expect(
      db.insert(usuariosSectores).values({ usuarioId: user.id, sectorId: 999999 }),
    ).rejects.toThrow();
  });

  it("rejects role assignments for nonexistent users", async () => {
    await runMigrations(db);

    const [adminRole] = await db.select().from(roles).where(eq(roles.codigo, "admin")).limit(1);

    await expect(
      db.insert(usuariosRoles).values({
        usuarioId: "00000000-0000-0000-0000-000000000000",
        rolId: adminRole.id,
      }),
    ).rejects.toThrow();
  });

  it("enforces role and sector assignments through composite keys and foreign keys", async () => {
    await runMigrations(db);

    const [estudio] = await db.select().from(estudios).limit(1);
    const [adminRole] = await db.select().from(roles).where(eq(roles.codigo, "admin")).limit(1);
    const [sector] = await db.select().from(sectores).limit(1);
    const [user] = await db.insert(usuarios).values({
      email: `roles-${Date.now()}@test.com`,
      estudioId: estudio.id,
    }).returning();
    createdUserIds.push(user.id);

    await db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: adminRole.id });
    await expect(
      db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: adminRole.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: 999999 }),
    ).rejects.toThrow();

    await db.insert(usuariosSectores).values({ usuarioId: user.id, sectorId: sector.id });
    await expect(
      db.insert(usuariosSectores).values({ usuarioId: user.id, sectorId: sector.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(usuariosSectores).values({
        usuarioId: "00000000-0000-0000-0000-000000000000",
        sectorId: sector.id,
      }),
    ).rejects.toThrow();
  });
});
