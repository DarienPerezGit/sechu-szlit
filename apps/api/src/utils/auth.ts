import type { FastifyRequest, FastifyReply } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { type Database, sessions, usuarios, type Usuario } from "@sechub/db";

export const SESSION_COOKIE_NAME = "sessionId";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PG_UNIQUE_VIOLATION = "23505";

export function cookieOptions(isProduction: boolean, expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: isProduction,
    signed: true,
    ...(expires ? { expires } : {}),
  };
}

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
 * `null` on any failure — matching the contract of `getAuthenticatedUser`.
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
// Legacy cookie-based authentication (dev compatibility only)
// ---------------------------------------------------------------------------

export async function getSessionCookieUser(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): Promise<Usuario | null> {
  const cookieVal = request.cookies[SESSION_COOKIE_NAME];
  if (!cookieVal) {
    reply.status(401).send({ error: "No autenticado" });
    return null;
  }

  const unsigned = request.unsignCookie(cookieVal);
  if (!unsigned.valid || !unsigned.value) {
    reply.status(401).send({ error: "Sesión inválida" });
    return null;
  }

  const sessionId = unsigned.value;
  if (!UUID_REGEX.test(sessionId)) {
    reply.status(401).send({ error: "Sesión inválida" });
    return null;
  }

  const now = new Date();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session || session.expiresAt <= now) {
    reply.status(401).send({ error: "Sesión inválida" });
    return null;
  }

  const [user] = await db
    .select()
    .from(usuarios)
    .where(eq(usuarios.id, session.usuarioId))
    .limit(1);

  if (!user) {
    reply.status(401).send({ error: "Usuario no encontrado" });
    return null;
  }

  if (!user.activo) {
    reply.status(403).send({ error: "Cuenta desactivada" });
    return null;
  }

  return user;
}

// ---------------------------------------------------------------------------
// Unified auth: Bearer first, cookie fallback (dev compat)
// ---------------------------------------------------------------------------

/** Authenticate a request by checking the `Authorization: Bearer` header
 * first. If there is a Bearer header, validates via Supabase and rejects if
 * the client is not configured. If there is no Bearer header, falls back to
 * the legacy cookie path (dev only).
 */
export async function getAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): Promise<Usuario | null> {
  const authHeader = request.headers.authorization;

  if (authHeader !== undefined) {
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

  // No Authorization header: fall back to session cookie (dev compat).
  return getSessionCookieUser(request, reply, db);
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
