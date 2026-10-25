import type { FastifyRequest, FastifyReply } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { type Database, usuarios, type Usuario } from "@sechub/db";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Supabase Bearer token verification
// ---------------------------------------------------------------------------

/** Resolve a raw Bearer token to an internal `usuarios` row.
 *
 * 1. Validates the JWT through Supabase Auth (`getUser`).
 * 2. Looks up `usuarios.supabase_user_id = sub`.
 * 3. Rejects missing or inactive (`activo = false`) profiles.
 *
 * Returns the internal user row on success, or sends a 401/403 and returns
 * `null` on any failure.
 */
export async function resolveSupabaseToken(
  token: string,
  supabase: SupabaseClient,
  db: Database,
  reply: FastifyReply,
): Promise<Usuario | null> {
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    reply.status(401).send({ error: "Token inválido o expirado" });
    return null;
  }

  const supabaseUid = data.user.id;

  const [user] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.supabaseUserId, supabaseUid))
    .limit(1);

  if (!user) {
    reply.status(401).send({ error: "Perfil interno no encontrado" });
    return null;
  }

  if (!user.activo) {
    reply.status(403).send({ error: "Cuenta desactivada" });
    return null;
  }

  return user;
}

// ---------------------------------------------------------------------------
// Bearer-only authentication (post-cutover)
// ---------------------------------------------------------------------------

/** Authenticate a request strictly via the `Authorization: Bearer` header.
 * Legacy local session cookies are never accepted.
 */
export async function getAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): Promise<Usuario | null> {
  const authHeader = request.headers.authorization;

  if (authHeader === undefined) {
    reply.status(401).send({ error: "No autenticado" });
    return null;
  }

  if (!authHeader.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Token inválido o expirado" });
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    reply.status(401).send({ error: "Token inválido o expirado" });
    return null;
  }

  const supabase = request.server.supabase;
  if (!supabase) {
    reply.status(401).send({ error: "Autenticación Supabase no configurada" });
    return null;
  }

  return resolveSupabaseToken(token, supabase, db, reply);
}

// ---------------------------------------------------------------------------
// Supabase client factory
// ---------------------------------------------------------------------------

export function createSupabaseClient(
  supabaseUrl: string | undefined,
  supabaseAnonKey: string | undefined,
): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
