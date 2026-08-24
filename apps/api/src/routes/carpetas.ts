import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and } from "drizzle-orm";
import { type Database, carpetas, bitacoraCarpetas, empleadores } from "@sechub/db";
import { getAuthenticatedUser, UUID_REGEX, PG_UNIQUE_VIOLATION } from "../utils/auth.js";
import {
  canWriteSector,
  getWriteAuthorization,
  requireWriteAuthorization,
  sendForbidden,
} from "../authorization.js";

export interface CarpetasPluginOptions {
  db: Database;
}

async function checkEmpleadorOwnership(
  db: Database,
  empleadorId: string | undefined | null,
  estudioId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!empleadorId) return true;

  if (!UUID_REGEX.test(empleadorId)) {
    reply.status(400).send({ error: "ID de empleador inválido" });
    return false;
  }

  const [empleador] = await db
    .select()
    .from(empleadores)
    .where(
      and(
        eq(empleadores.id, empleadorId),
        eq(empleadores.estudioId, estudioId),
      )
    )
    .limit(1);

  if (!empleador) {
    reply.status(400).send({ error: "El empleador especificado no existe o no pertenece a su estudio" });
    return false;
  }

  return true;
}

function handleDbError(err: any, reply: FastifyReply) {
  if (err.code === PG_UNIQUE_VIOLATION || err.message?.includes("unique")) {
    return reply.status(400).send({ error: "El expediente ya existe" });
  }
  throw err;
}

export async function carpetasRoutes(
  app: FastifyInstance,
  opts: CarpetasPluginOptions,
) {
  const { db } = opts;

  // GET /api/carpetas
  app.get("/carpetas", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const data = await db
      .select()
      .from(carpetas)
      .where(eq(carpetas.estudioId, user.estudioId));

    return reply.status(200).send(data);
  });

  // GET /api/carpetas/:id
  app.get<{ Params: { id: string } }>("/carpetas/:id", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const { id } = request.params;
    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: "ID inválido" });
    }

    const [carpeta] = await db
      .select()
      .from(carpetas)
      .where(and(eq(carpetas.id, id), eq(carpetas.estudioId, user.estudioId)))
      .limit(1);

    if (!carpeta) {
      return reply.status(404).send({ error: "Carpeta no encontrada" });
    }

    return reply.status(200).send(carpeta);
  });

  // POST /api/carpetas
  app.post<{
    Body: {
      sectorActualId: number;
      estadoCasoId: number;
      expediente: string;
      caratula: string;
      demandada: string;
      empleadorId?: string | null;
    };
  }>("/carpetas", {
    preValidation: requireWriteAuthorization(db),
    schema: {
      body: {
        type: "object",
        required: ["sectorActualId", "estadoCasoId", "expediente", "caratula", "demandada"],
        properties: {
          sectorActualId: { type: "integer" },
          estadoCasoId: { type: "integer" },
          expediente: { type: "string" },
          caratula: { type: "string" },
          demandada: { type: "string" },
          empleadorId: { type: ["string", "null"] },
        },
      },
    },
  }, async (request, reply) => {
    const { user, authorization } = getWriteAuthorization(request);
    const { sectorActualId, estadoCasoId, expediente, caratula, demandada, empleadorId } = request.body;
    if (!canWriteSector(authorization, sectorActualId)) {
      return sendForbidden(reply);
    }

    const hasOwnership = await checkEmpleadorOwnership(db, empleadorId, user.estudioId, reply);
    if (!hasOwnership) return;

    try {
      const result = await db.transaction(async (tx) => {
        const [carpeta] = await tx
          .insert(carpetas)
          .values({
            estudioId: user.estudioId,
            sectorActualId,
            estadoCasoId,
            expediente,
            caratula,
            demandada,
            empleadorId: empleadorId || null,
          })
          .returning();

        await tx
          .insert(bitacoraCarpetas)
          .values({
            carpetaId: carpeta.id,
            usuarioId: user.id,
            accionRealizada: "Carpeta creada manualmente",
            metadata: { source: "api" },
          });

        return carpeta;
      });

      return reply.status(201).send(result);
    } catch (err: any) {
      return handleDbError(err, reply);
    }
  });

  // PATCH /api/carpetas/:id
  app.patch<{
    Params: { id: string };
    Body: {
      version: number;
      sectorActualId?: number;
      estadoCasoId?: number;
      expediente?: string;
      caratula?: string;
      demandada?: string;
      empleadorId?: string | null;
    };
  }>("/carpetas/:id", {
    preValidation: requireWriteAuthorization(db),
    schema: {
      body: {
        type: "object",
        required: ["version"],
        properties: {
          version: { type: "integer" },
          sectorActualId: { type: "integer" },
          estadoCasoId: { type: "integer" },
          expediente: { type: "string" },
          caratula: { type: "string" },
          demandada: { type: "string" },
          empleadorId: { type: ["string", "null"] },
        },
      },
    },
  }, async (request, reply) => {
    const { user, authorization } = getWriteAuthorization(request);
    const { id } = request.params;
    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: "ID inválido" });
    }

    const { version, sectorActualId, estadoCasoId, expediente, caratula, demandada, empleadorId } = request.body;

    // Prevent mass assignment: construct sanitized update fields
    const updateFields: any = {};
    if (sectorActualId !== undefined) updateFields.sectorActualId = sectorActualId;
    if (estadoCasoId !== undefined) updateFields.estadoCasoId = estadoCasoId;
    if (expediente !== undefined) updateFields.expediente = expediente;
    if (caratula !== undefined) updateFields.caratula = caratula;
    if (demandada !== undefined) updateFields.demandada = demandada;
    if (empleadorId !== undefined) updateFields.empleadorId = empleadorId;

    const [existing] = await db
      .select()
      .from(carpetas)
      .where(and(eq(carpetas.id, id), eq(carpetas.estudioId, user.estudioId)))
      .limit(1);

    if (!existing) {
      return reply.status(404).send({ error: "Carpeta no encontrada" });
    }

    if (!canWriteSector(authorization, existing.sectorActualId)) {
      return sendForbidden(reply);
    }

    const hasOwnership = await checkEmpleadorOwnership(db, empleadorId, user.estudioId, reply);
    if (!hasOwnership) return;

    if (existing.version !== version) {
      return reply.status(409).send({ error: "la carpeta cambió, recargá" });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(carpetas)
          .set({
            ...updateFields,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(carpetas.id, id),
              eq(carpetas.estudioId, user.estudioId),
              eq(carpetas.version, version),
            )
          )
          .returning();

        if (!updated) {
          return null;
        }

        await tx
          .insert(bitacoraCarpetas)
          .values({
            carpetaId: id,
            usuarioId: user.id,
            accionRealizada: "Carpeta actualizada",
            metadata: { fieldsUpdated: Object.keys(updateFields) },
          });

        return updated;
      });

      if (!result) {
        return reply.status(409).send({ error: "la carpeta cambió, recargá" });
      }

      return reply.status(200).send(result);
    } catch (err: any) {
      return handleDbError(err, reply);
    }
  });
}
