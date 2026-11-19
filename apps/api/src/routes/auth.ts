import type { FastifyInstance } from "fastify";
import { type Database } from "@sechub/db";
import { loadAuthorization, perfil } from "../authorization.js";
import { getAuthenticatedUser } from "../utils/auth.js";

export interface AuthPluginOptions {
  db: Database;
}

export async function authRoutes(
  app: FastifyInstance,
  opts: AuthPluginOptions,
) {
  const { db } = opts;

  // GET /api/auth/me — identidad y perfil resuelto (titular, abogado o asistente).
  // No exige rol: un usuario sin rol asignado puede ver que no tiene acceso.
  app.get("/me", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const authorization = await loadAuthorization(db, user);
    return reply.status(200).send({
      user: {
        id: user.id,
        email: user.email,
        estudioId: user.estudioId,
        role: authorization.rol,
        roles: authorization.rol ? [authorization.rol] : [],
        esTitular: authorization.esTitular,
        perfil: perfil(authorization),
      },
    });
  });
}
