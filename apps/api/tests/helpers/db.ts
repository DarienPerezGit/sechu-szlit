import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import {
  ROLE_CODES,
  createDatabase,
  runMigrations,
  type Database,
  type RoleCode,
  type Usuario,
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

/**
 * Default test-mode Supabase client stub: treats a Bearer token as the raw
 * `supabase_user_id` UUID when it matches UUID format, so domain route tests
 * can authenticate without network calls.
 */
export function createTestSupabaseClient(): SupabaseClient {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    auth: {
      getUser: async (token: string) => {
        if (uuidRegex.test(token)) {
          return { data: { user: { id: token } }, error: null };
        }
        return { data: { user: null }, error: new Error("Invalid test token") };
      },
    },
  } as unknown as SupabaseClient;
}

export async function seedUser(
  db: Database,
  overrides: {
    email?: string;
    password?: string;
    role?: RoleCode;
    supabaseUserId?: string | null;
    activo?: boolean;
  } = {},
): Promise<{
  id: string;
  email: string;
  password: string;
  estudioId: string;
  supabaseUserId: string | null;
  authHeader: string;
  user: Usuario;
}> {
  const [estudio] = await db.select().from(estudios).limit(1);
  if (!estudio) {
    throw new Error("No seed estudio found; run migrations first");
  }

  const email = overrides.email ?? "test@estudioszlit.com.ar";
  const password = overrides.password ?? "Secr3tP@ss";
  const role = overrides.role ?? ROLE_CODES.ADMIN;
  const supabaseUserId =
    overrides.supabaseUserId === undefined ? randomUUID() : overrides.supabaseUserId;

  const [user] = await db
    .insert(usuarios)
    .values({
      email,
      passwordHash: "(managed-by-supabase-auth)",
      estudioId: estudio.id,
      supabaseUserId,
      activo: overrides.activo ?? true,
    })
    .returning();

  await db.execute(sql`
    INSERT INTO usuarios_roles (usuario_id, rol_id)
    SELECT ${user.id}, roles.id
    FROM roles
    WHERE roles.codigo = ${role}
    ON CONFLICT (usuario_id, rol_id) DO NOTHING
  `);

  return {
    id: user.id,
    email,
    password,
    estudioId: user.estudioId,
    supabaseUserId,
    authHeader: supabaseUserId ? `Bearer ${supabaseUserId}` : "",
    user,
  };
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
