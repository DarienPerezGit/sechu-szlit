import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  type Database,
  estadosActa,
  estadosCaso,
  sectores,
  tiposActa,
  tiposAudiencia,
} from "@sechub/db";

export interface CatalogosPluginOptions {
  db: Database;
}

export async function catalogosRoutes(
  app: FastifyInstance,
  opts: CatalogosPluginOptions,
) {
  const { db } = opts;

  app.get("/sectores", async (request, reply) => {
    const data = await db
      .select()
      .from(sectores)
      .where(eq(sectores.activo, true))
      .orderBy(sectores.ordenPipeline, sectores.id);
    return reply.status(200).send(data);
  });

  app.get("/estados-caso", async (request, reply) => {
    const data = await db
      .select()
      .from(estadosCaso)
      .where(eq(estadosCaso.activo, true))
      .orderBy(estadosCaso.id);
    return reply.status(200).send(data);
  });

  app.get("/tipos-audiencia", async (request, reply) => {
    const data = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.activo, true))
      .orderBy(tiposAudiencia.id);
    return reply.status(200).send(data);
  });

  app.get("/tipos-acta", async (request, reply) => {
    const data = await db
      .select()
      .from(tiposActa)
      .where(eq(tiposActa.activo, true))
      .orderBy(tiposActa.id);
    return reply.status(200).send(data);
  });

  app.get("/estados-acta", async (request, reply) => {
    const data = await db
      .select()
      .from(estadosActa)
      .where(eq(estadosActa.activo, true))
      .orderBy(estadosActa.id);
    return reply.status(200).send(data);
  });
}
