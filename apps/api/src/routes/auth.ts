import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { eq, lt } from "drizzle-orm";
import { type Database, sessions, usuarios } from "@sechub/db";

const SESSION_COOKIE_NAME = "sessionId";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthPluginOptions {
  db: Database;
  isProduction: boolean;
}

function cookieOptions(isProduction: boolean, expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: isProduction,
    signed: true,
    ...(expires ? { expires } : {}),
  };
}

function serializeUser(user: {
  id: string;
  email: string;
  role: string;
  estudioId: string;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    estudioId: user.estudioId,
  };
}

export async function authRoutes(
  app: FastifyInstance,
  opts: AuthPluginOptions,
) {
  const { db, isProduction } = opts;

  app.post<{
    Body: { email: string; password: string };
  }>("/login", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    const [user] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: "Credenciales inválidas" });
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({ error: "Credenciales inválidas" });
    }

    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const [session] = await db
      .insert(sessions)
      .values({
        usuarioId: user.id,
        expiresAt,
      })
      .returning();

    reply.setCookie(
      SESSION_COOKIE_NAME,
      session.id,
      cookieOptions(isProduction, expiresAt),
    );

    return reply.status(200).send({ user: serializeUser(user) });
  });

  app.get("/me", async (request, reply) => {
    const cookieVal = request.cookies[SESSION_COOKIE_NAME];
    if (!cookieVal) {
      return reply.status(401).send({ error: "No autenticado" });
    }

    const unsigned = request.unsignCookie(cookieVal);
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(401).send({ error: "Sesión inválida" });
    }

    const sessionId = unsigned.value;
    if (!UUID_REGEX.test(sessionId)) {
      return reply.status(401).send({ error: "Sesión inválida" });
    }

    const now = new Date();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session || session.expiresAt <= now) {
      return reply.status(401).send({ error: "Sesión inválida" });
    }

    const [user] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.id, session.usuarioId))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: "Usuario no encontrado" });
    }

    return reply.status(200).send({ user: serializeUser(user) });
  });

  app.post("/logout", async (request, reply) => {
    const cookieVal = request.cookies[SESSION_COOKIE_NAME];

    if (cookieVal) {
      const unsigned = request.unsignCookie(cookieVal);
      if (unsigned.valid && unsigned.value) {
        await db.delete(sessions).where(eq(sessions.id, unsigned.value));
      }
    }

    // Opportunistically purge already-expired sessions on every logout.
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions(isProduction));

    return reply.status(200).send({ ok: true });
  });
}
