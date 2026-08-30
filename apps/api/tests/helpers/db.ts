import argon2 from "argon2";
import { sql } from "drizzle-orm";
import {
  ROLE_CODES,
  createDatabase,
  runMigrations,
  type Database,
  type RoleCode,
  estudios,
  sessions,
  usuarios,
  carpetas,
  bitacoraCarpetas,
  empleadores,
  audiencias,
  actas,
} from "@sechub/db";

export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    "postgresql://sechub:sechub@localhost:5432/sechub"
  );
}

export async function createTestDatabase(): Promise<Database> {
  const db = createDatabase(getDatabaseUrl());
  await runMigrations(db);
  return db;
}

export async function seedUser(
  db: Database,
  overrides: {
    email?: string;
    password?: string;
    role?: RoleCode;
  } = {},
): Promise<{ email: string; password: string; estudioId: string }> {
  const [estudio] = await db.select().from(estudios).limit(1);
  if (!estudio) {
    throw new Error("No seed estudio found; run migrations first");
  }

  const email = overrides.email ?? "test@estudioszlit.com.ar";
  const password = overrides.password ?? "Secr3tP@ss";
  const role = overrides.role ?? ROLE_CODES.ADMIN;

  const passwordHash = await argon2.hash(password);
  const [user] = await db
    .insert(usuarios)
    .values({
      email,
      passwordHash,
      estudioId: estudio.id,
    })
    .returning();

  await db.execute(sql`
    INSERT INTO usuarios_roles (usuario_id, rol_id)
    SELECT ${user.id}, roles.id
    FROM roles
    WHERE roles.codigo = ${role}
    ON CONFLICT (usuario_id, rol_id) DO NOTHING
  `);

  return { email, password, estudioId: user.estudioId };
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.delete(actas);
  await db.delete(audiencias);
  await db.delete(bitacoraCarpetas);
  await db.delete(carpetas);
  await db.delete(empleadores);
  await db.delete(sessions);
  await db.execute(sql`DELETE FROM usuarios_roles`);
  await db.execute(sql`DELETE FROM usuarios_sectores`);
  await db.delete(usuarios);
}
