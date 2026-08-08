import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { type Database, sessions, usuarios } from "@sechub/db";

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

export async function getAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
) {
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

  return user;
}
