import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createDatabase,
  runMigrations,
  estudios,
  roles,
  usuarios,
  usuariosRoles,
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
      await db.delete(usuarios).where(eq(usuarios.id, userId));
    }
  });

  async function newUser(label: string) {
    const [estudio] = await db.select().from(estudios).limit(1);
    const [user] = await db.insert(usuarios).values({
      email: `roles-${label}-${Date.now()}@test.com`,
      estudioId: estudio.id,
    }).returning();
    createdUserIds.push(user.id);
    return user;
  }

  it("seeds exactly the abogado and asistente roles, idempotently", async () => {
    await runMigrations(db);
    await runMigrations(db);

    const seededRoles = await db.select().from(roles);
    expect(seededRoles.map((role) => role.codigo).sort()).toEqual(["abogado", "asistente"]);
  });

  it("models titular as a flag on usuarios, false by default", async () => {
    await runMigrations(db);
    const user = await newUser("titular-default");
    expect(user.esTitular).toBe(false);
  });

  it("drops the sector-based permission table", async () => {
    await runMigrations(db);
    const result = await db.execute(sql`SELECT to_regclass('public.usuarios_sectores') AS name`);
    expect((result.rows[0] as { name: string | null }).name).toBeNull();
  });

  it("rejects role assignments for nonexistent users", async () => {
    await runMigrations(db);

    const [abogado] = await db.select().from(roles).where(eq(roles.codigo, "abogado")).limit(1);

    await expect(
      db.insert(usuariosRoles).values({
        usuarioId: "00000000-0000-0000-0000-000000000000",
        rolId: abogado.id,
      }),
    ).rejects.toThrow();
  });

  it("allows a single role per user and rejects unknown roles", async () => {
    await runMigrations(db);

    const [abogado] = await db.select().from(roles).where(eq(roles.codigo, "abogado")).limit(1);
    const [asistente] = await db.select().from(roles).where(eq(roles.codigo, "asistente")).limit(1);
    const user = await newUser("single-role");

    await db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: abogado.id });
    await expect(
      db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: asistente.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(usuariosRoles).values({ usuarioId: user.id, rolId: 999999 }),
    ).rejects.toThrow();
  });
});
