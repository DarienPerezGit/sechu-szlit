import argon2 from "argon2";
import { createDatabase, runMigrations, type Database, estudios, sessions, usuarios } from "@sechub/db";

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
    role?: string;
  } = {},
): Promise<{ email: string; password: string; estudioId: string }> {
  const [estudio] = await db.select().from(estudios).limit(1);
  if (!estudio) {
    throw new Error("No seed estudio found; run migrations first");
  }

  const email = overrides.email ?? "test@estudioszlit.com.ar";
  const password = overrides.password ?? "Secr3tP@ss";
  const role = overrides.role ?? "admin";

  const passwordHash = await argon2.hash(password);
  const [user] = await db
    .insert(usuarios)
    .values({
      email,
      passwordHash,
      role,
      estudioId: estudio.id,
    })
    .returning();

  return { email, password, estudioId: user.estudioId };
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.delete(sessions);
  await db.delete(usuarios);
}
