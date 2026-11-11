import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { type Database, usuarios } from "@sechub/db";
import { getAuthenticatedUser } from "../utils/auth.js";

export interface EquipoPluginOptions {
  db: Database;
}

/**
 * Miembros activos del estudio. Solo expone id y email: lo necesario para
 * asignar un abogado a una audiencia, sin datos de identidad de Supabase.
 */
export async function equipoRoutes(app: FastifyInstance, opts: EquipoPluginOptions) {
  const { db } = opts;

  app.get("/equipo", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const data = await db
      .select({ id: usuarios.id, email: usuarios.email })
      .from(usuarios)
      .where(and(eq(usuarios.estudioId, user.estudioId), eq(usuarios.activo, true)))
      .orderBy(usuarios.email);

    return reply.status(200).send(data);
  });
}
