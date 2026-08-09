import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import {
  type Database,
  audiencias,
  carpetas,
  usuarios,
  tiposAudiencia,
  bitacoraCarpetas,
} from "@sechub/db";
import { getAuthenticatedUser, UUID_REGEX } from "../utils/auth.js";

export interface AudienciasPluginOptions {
  db: Database;
}

async function checkAbogadoOwnership(
  db: Database,
  abogadoId: string,
  estudioId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!UUID_REGEX.test(abogadoId)) {
    reply.status(400).send({ error: "ID de abogado inválido" });
    return false;
  }

  const [abogado] = await db
    .select()
    .from(usuarios)
    .where(
      and(
        eq(usuarios.id, abogadoId),
        eq(usuarios.estudioId, estudioId),
      ),
    )
    .limit(1);

  if (!abogado) {
    reply.status(400).send({ error: "El abogado especificado no existe o no pertenece a su estudio" });
    return false;
  }

  return true;
}

async function checkCarpetaOwnership(
  db: Database,
  carpetaId: string,
  estudioId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!UUID_REGEX.test(carpetaId)) {
    reply.status(400).send({ error: "ID de carpeta inválido" });
    return false;
  }

  const [carpeta] = await db
    .select()
    .from(carpetas)
    .where(
      and(
        eq(carpetas.id, carpetaId),
        eq(carpetas.estudioId, estudioId),
      ),
    )
    .limit(1);

  if (!carpeta) {
    reply.status(400).send({ error: "La carpeta especificada no existe o no pertenece a su estudio" });
    return false;
  }

  return true;
}

export async function audienciasRoutes(
  app: FastifyInstance,
  opts: AudienciasPluginOptions,
) {
  const { db } = opts;

  // GET /api/audiencias/orphan — must be registered BEFORE :id routes
  app.get("/audiencias/orphan", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const data = await db
      .select()
      .from(audiencias)
      .where(
        and(
          eq(audiencias.estudioId, user.estudioId),
          isNull(audiencias.carpetaId),
        ),
      )
      .orderBy(audiencias.fecha, audiencias.hora);

    return reply.status(200).send(data);
  });

  // GET /api/audiencias?fecha=YYYY-MM-DD — agenda del día
  app.get<{ Querystring: { fecha?: string } }>("/audiencias", async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const { fecha } = request.query;

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return reply.status(400).send({ error: "Parámetro 'fecha' requerido (YYYY-MM-DD)" });
    }

    const data = await db
      .select({
        id: audiencias.id,
        estudioId: audiencias.estudioId,
        carpetaId: audiencias.carpetaId,
        abogadoId: audiencias.abogadoId,
        fecha: audiencias.fecha,
        hora: audiencias.hora,
        tipoAudienciaId: audiencias.tipoAudienciaId,
        linkReunion: audiencias.linkReunion,
        linkDetalle: audiencias.linkDetalle,
        notasInternas: audiencias.notasInternas,
        createdAt: audiencias.createdAt,
        updatedAt: audiencias.updatedAt,
        caratula: carpetas.caratula,
        abogadoEmail: usuarios.email,
        tipoNombre: tiposAudiencia.nombre,
        tipoColor: tiposAudiencia.color,
      })
      .from(audiencias)
      .leftJoin(carpetas, eq(audiencias.carpetaId, carpetas.id))
      .leftJoin(usuarios, eq(audiencias.abogadoId, usuarios.id))
      .leftJoin(tiposAudiencia, eq(audiencias.tipoAudienciaId, tiposAudiencia.id))
      .where(
        and(
          eq(audiencias.estudioId, user.estudioId),
          eq(audiencias.fecha, fecha),
        ),
      )
      .orderBy(audiencias.hora);

    return reply.status(200).send(data);
  });

  // POST /api/audiencias
  app.post<{
    Body: {
      carpetaId?: string | null;
      abogadoId: string;
      fecha: string;
      hora: string;
      tipoAudienciaId: number;
      linkReunion?: string | null;
      linkDetalle?: string | null;
      notasInternas?: string | null;
    };
  }>("/audiencias", {
    schema: {
      body: {
        type: "object",
        required: ["abogadoId", "fecha", "hora", "tipoAudienciaId"],
        properties: {
          carpetaId: { type: ["string", "null"] },
          abogadoId: { type: "string" },
          fecha: { type: "string" },
          hora: { type: "string" },
          tipoAudienciaId: { type: "integer" },
          linkReunion: { type: ["string", "null"] },
          linkDetalle: { type: ["string", "null"] },
          notasInternas: { type: ["string", "null"] },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const {
      carpetaId,
      abogadoId,
      fecha,
      hora,
      tipoAudienciaId,
      linkReunion,
      linkDetalle,
      notasInternas,
    } = request.body;

    // Validate fecha format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return reply.status(400).send({ error: "Formato de fecha inválido (YYYY-MM-DD)" });
    }

    // Validate hora format
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) {
      return reply.status(400).send({ error: "Formato de hora inválido (HH:MM o HH:MM:SS)" });
    }

    // Validate abogado ownership
    const abogadoOk = await checkAbogadoOwnership(db, abogadoId, user.estudioId, reply);
    if (!abogadoOk) return;

    // Validate tipoAudienciaId exists
    const [tipo] = await db
      .select()
      .from(tiposAudiencia)
      .where(eq(tiposAudiencia.id, tipoAudienciaId))
      .limit(1);

    if (!tipo) {
      return reply.status(400).send({ error: "El tipo de audiencia especificado no existe" });
    }

    // Validate carpeta ownership if provided
    if (carpetaId) {
      const carpetaOk = await checkCarpetaOwnership(db, carpetaId, user.estudioId, reply);
      if (!carpetaOk) return;
    }

    const [audiencia] = await db
      .insert(audiencias)
      .values({
        estudioId: user.estudioId,
        carpetaId: carpetaId || null,
        abogadoId,
        fecha,
        hora,
        tipoAudienciaId,
        linkReunion: linkReunion || null,
        linkDetalle: linkDetalle || null,
        notasInternas: notasInternas || null,
      })
      .returning();

    return reply.status(201).send(audiencia);
  });

  // PATCH /api/audiencias/:id/vincular
  app.patch<{
    Params: { id: string };
    Body: { carpetaId: string };
  }>("/audiencias/:id/vincular", {
    schema: {
      body: {
        type: "object",
        required: ["carpetaId"],
        properties: {
          carpetaId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const { id } = request.params;
    const { carpetaId } = request.body;

    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: "ID de audiencia inválido" });
    }

    // Validate audiencia exists and belongs to estudio
    const [audiencia] = await db
      .select()
      .from(audiencias)
      .where(
        and(
          eq(audiencias.id, id),
          eq(audiencias.estudioId, user.estudioId),
        ),
      )
      .limit(1);

    if (!audiencia) {
      return reply.status(404).send({ error: "Audiencia no encontrada" });
    }

    // Check not already linked
    if (audiencia.carpetaId !== null) {
      return reply.status(400).send({ error: "La audiencia ya está vinculada a una carpeta" });
    }

    // Validate target carpeta ownership
    const carpetaOk = await checkCarpetaOwnership(db, carpetaId, user.estudioId, reply);
    if (!carpetaOk) return;

    // Link in a transaction with bitacora
    try {
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(audiencias)
          .set({ carpetaId, updatedAt: new Date() })
          .where(
            and(
              eq(audiencias.id, id),
              eq(audiencias.estudioId, user.estudioId),
              isNull(audiencias.carpetaId),
            ),
          )
          .returning();

        if (!updated) {
          return null;
        }

        await tx.insert(bitacoraCarpetas).values({
          carpetaId,
          usuarioId: user.id,
          accionRealizada: "audiencia_vinculada",
          metadata: { audienciaId: id },
        });

        return updated;
      });

      if (!result) {
        return reply.status(409).send({ error: "La audiencia ya fue vinculada por otro usuario" });
      }

      return reply.status(200).send(result);
    } catch (err: any) {
      throw err;
    }
  });
}
