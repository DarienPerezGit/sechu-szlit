import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { eq, lt } from "drizzle-orm";
import {
  type Database,
  roles,
  sessions,
  usuarios,
  usuariosRoles,
} from "@sechub/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
  UUID_REGEX,
  cookieOptions,
  getAuthenticatedUser,
} from "../utils/auth.js";

export interface AuthPluginOptions {
  db: Database;
  isProduction: boolean;
}

async function loadUserRoles(db: Database, userId: string): Promise<string[]> {
  const assignedRoles = await db
    .select({ codigo: roles.codigo })
    .from(usuariosRoles)
    .innerJoin(roles, eq(roles.id, usuariosRoles.rolId))
    .where(eq(usuariosRoles.usuarioId, userId))
    .orderBy(roles.id);

  return assignedRoles.map(({ codigo }) => codigo);
}

function serializeUser(
  user: { id: string; email: string; estudioId: string },
  assignedRoles: string[],
) {
  return {
    id: user.id,
    email: user.email,
    role: assignedRoles[0],
    roles: assignedRoles,
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

    const assignedRoles = await loadUserRoles(db, user.id);
    return reply.status(200).send({ user: serializeUser(user, assignedRoles) });
  });

  app.get("/me", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const assignedRoles = await loadUserRoles(db, user.id);
    return reply.status(200).send({ user: serializeUser(user, assignedRoles) });
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
