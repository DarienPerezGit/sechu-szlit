import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  actas,
  carpetas,
  estadosActa,
  type Database,
  tiposActa,
} from "@sechub/db";
import { ActaLinkError, linkActa } from "../acta-linking.js";
import {
  canWriteSector,
  getWriteAuthorization,
  requireWriteAuthorization,
  sendForbidden,
} from "../authorization.js";
import { getAuthenticatedUser, UUID_REGEX } from "../utils/auth.js";

export interface ActasPluginOptions {
  db: Database;
}

async function checkCarpeta(
  db: Database,
  carpetaId: string,
  estudioId: string,
  reply: FastifyReply,
) {
  if (!UUID_REGEX.test(carpetaId)) {
    reply.status(400).send({ error: "ID de carpeta inválido" });
    return null;
  }

  const [carpeta] = await db
    .select()
    .from(carpetas)
    .where(and(eq(carpetas.id, carpetaId), eq(carpetas.estudioId, estudioId)))
    .limit(1);

  if (!carpeta) {
    reply.status(400).send({ error: "La carpeta especificada no existe o no pertenece a su estudio" });
    return null;
  }

  return carpeta;
}

function sendLinkError(reply: FastifyReply, error: unknown) {
  if (error instanceof ActaLinkError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  throw error;
}

export async function actasRoutes(
  app: FastifyInstance,
  opts: ActasPluginOptions,
) {
  const { db } = opts;

  app.get("/actas/orphan", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const data = await db
      .select()
      .from(actas)
      .where(and(eq(actas.estudioId, user.estudioId), isNull(actas.carpetaId)))
      .orderBy(actas.createdAt, actas.id);

    return reply.status(200).send(data);
  });

  app.post<{
    Body: {
      carpetaId?: string | null;
      expediente?: string | null;
      tipoActaId: number;
      estadoActaId: number;
      conciliadorNombre?: string | null;
      conciliadorEmail?: string | null;
      fecha?: string | null;
    };
  }>("/actas", {
    preValidation: requireWriteAuthorization(db),
    schema: {
      body: {
        type: "object",
        required: ["tipoActaId", "estadoActaId"],
        properties: {
          carpetaId: { type: ["string", "null"] },
          expediente: { type: ["string", "null"] },
          tipoActaId: { type: "integer" },
          estadoActaId: { type: "integer" },
          conciliadorNombre: { type: ["string", "null"] },
          conciliadorEmail: { type: ["string", "null"] },
          fecha: { type: ["string", "null"] },
        },
      },
    },
  }, async (request, reply) => {
    const { user, authorization } = getWriteAuthorization(request);
    const {
      carpetaId,
      expediente,
      tipoActaId,
      estadoActaId,
      conciliadorNombre,
      conciliadorEmail,
      fecha,
    } = request.body;

    if (fecha !== undefined && fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return reply.status(400).send({ error: "Formato de fecha inválido (YYYY-MM-DD)" });
    }

    const [tipo] = await db
      .select()
      .from(tiposActa)
      .where(and(eq(tiposActa.id, tipoActaId), eq(tiposActa.activo, true)))
      .limit(1);
    if (!tipo) {
      return reply.status(400).send({ error: "El tipo de acta especificado no existe" });
    }

    const [estado] = await db
      .select()
      .from(estadosActa)
      .where(and(eq(estadosActa.id, estadoActaId), eq(estadosActa.activo, true)))
      .limit(1);
    if (!estado) {
      return reply.status(400).send({ error: "El estado de acta especificado no existe" });
    }

    if (carpetaId !== undefined && carpetaId !== null) {
      const carpeta = await checkCarpeta(db, carpetaId, user.estudioId, reply);
      if (!carpeta) return;
      if (!canWriteSector(authorization, carpeta.sectorActualId)) {
        return sendForbidden(reply);
      }
    }

    const [created] = await db
      .insert(actas)
      .values({
        estudioId: user.estudioId,
        carpetaId: carpetaId ?? null,
        expediente: expediente || null,
        tipoActaId,
        estadoActaId,
        conciliadorNombre: conciliadorNombre || null,
        conciliadorEmail: conciliadorEmail || null,
        fecha: fecha || null,
      })
      .returning();

    return reply.status(201).send(created);
  });

  app.patch<{
    Params: { id: string };
    Body: { carpetaId: string; audienciaId: string };
  }>("/actas/:id/vincular", {
    preValidation: requireWriteAuthorization(db),
    schema: {
      body: {
        type: "object",
        required: ["carpetaId", "audienciaId"],
        properties: {
          carpetaId: { type: "string" },
          audienciaId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const { user, authorization } = getWriteAuthorization(request);
    const { id } = request.params;
    const { carpetaId, audienciaId } = request.body;

    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: "ID de acta inválido" });
    }
    if (!UUID_REGEX.test(carpetaId)) {
      return reply.status(400).send({ error: "ID de carpeta inválido" });
    }
    if (!UUID_REGEX.test(audienciaId)) {
      return reply.status(400).send({ error: "ID de audiencia inválido" });
    }

    try {
      const result = await linkActa(db, {
        actaId: id,
        carpetaId,
        audienciaId,
        estudioId: user.estudioId,
        usuarioId: user.id,
        authorization,
      });
      return reply.status(200).send(result);
    } catch (error) {
      return sendLinkError(reply, error);
    }
  });
}
