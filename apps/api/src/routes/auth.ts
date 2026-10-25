import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  type Database,
  roles,
  usuariosRoles,
} from "@sechub/db";
import { getAuthenticatedUser } from "../utils/auth.js";

export interface AuthPluginOptions {
  db: Database;
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
  const { db } = opts;

  app.get("/me", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const assignedRoles = await loadUserRoles(db, user.id);
    return reply.status(200).send({ user: serializeUser(user, assignedRoles) });
  });
}
