import { and, eq, isNull, sql } from "drizzle-orm";
import {
  ACTA_TYPE_CODES,
  actas,
  audiencias,
  AUDIENCIA_STATUS_CODES,
  bitacoraCarpetas,
  carpetas,
  estadosCaso,
  type Database,
  tiposActa,
} from "@sechub/db";
import { canWriteSector, type AuthorizationContext } from "./authorization.js";

const ACTA_TYPE_TO_CASE_STATUS: Record<string, string> = {
  [ACTA_TYPE_CODES.ACUERDO]: "conciliado",
  [ACTA_TYPE_CODES.DESISTIMIENTO]: "desestimado",
};

export class ActaLinkError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ActaLinkError";
  }
}

export interface LinkActaInput {
  actaId: string;
  carpetaId: string;
  audienciaId: string;
  estudioId: string;
  usuarioId: string;
  authorization: AuthorizationContext;
}

export async function linkActa(
  db: Database,
  input: LinkActaInput,
) {
  return db.transaction(async (tx) => {
    const [acta] = await tx
      .select({
        acta: actas,
        tipoCodigo: tiposActa.codigo,
      })
      .from(actas)
      .innerJoin(tiposActa, eq(tiposActa.id, actas.tipoActaId))
      .where(and(eq(actas.id, input.actaId), eq(actas.estudioId, input.estudioId)))
      .limit(1);

    if (!acta) {
      throw new ActaLinkError(404, "Acta no encontrada");
    }

    if (acta.acta.carpetaId !== null) {
      const [linkedCarpeta] = await tx
        .select()
        .from(carpetas)
        .where(
          and(
            eq(carpetas.id, acta.acta.carpetaId),
            eq(carpetas.estudioId, input.estudioId),
          ),
        )
        .limit(1);
      if (!linkedCarpeta || !canWriteSector(input.authorization, linkedCarpeta.sectorActualId)) {
        throw new ActaLinkError(403, "No autorizado");
      }
      throw new ActaLinkError(400, "El acta ya está vinculada a una carpeta");
    }

    const [linkedActa] = await tx
      .update(actas)
      .set({ carpetaId: input.carpetaId, updatedAt: new Date() })
      .where(
        and(
          eq(actas.id, input.actaId),
          eq(actas.estudioId, input.estudioId),
          isNull(actas.carpetaId),
        ),
      )
      .returning();

    if (!linkedActa) {
      throw new ActaLinkError(409, "El acta ya fue vinculada por otro usuario");
    }

    const [carpeta] = await tx
      .select({
        carpeta: carpetas,
        estadoCodigo: estadosCaso.codigo,
      })
      .from(carpetas)
      .innerJoin(estadosCaso, eq(estadosCaso.id, carpetas.estadoCasoId))
      .where(
        and(
          eq(carpetas.id, input.carpetaId),
          eq(carpetas.estudioId, input.estudioId),
        ),
      )
      .for("update")
      .limit(1);

    if (!carpeta) {
      throw new ActaLinkError(400, "La carpeta especificada no existe o no pertenece a su estudio");
    }

    if (!canWriteSector(input.authorization, carpeta.carpeta.sectorActualId)) {
      throw new ActaLinkError(403, "No autorizado");
    }

    const [audiencia] = await tx
      .select()
      .from(audiencias)
      .where(
        and(
          eq(audiencias.id, input.audienciaId),
          eq(audiencias.estudioId, input.estudioId),
        ),
      )
      .limit(1);

    if (!audiencia) {
      throw new ActaLinkError(400, "La audiencia especificada no existe o no pertenece a su estudio");
    }

    if (audiencia.carpetaId !== input.carpetaId) {
      throw new ActaLinkError(400, "La audiencia no está vinculada a la carpeta indicada");
    }

    if (audiencia.estado !== AUDIENCIA_STATUS_CODES.PENDIENTE) {
      throw new ActaLinkError(400, "La audiencia seleccionada no está pendiente");
    }

    const targetStatusCode = ACTA_TYPE_TO_CASE_STATUS[acta.tipoCodigo] ?? "en_tramite";
    const [targetStatus] = await tx
      .select()
      .from(estadosCaso)
      .where(eq(estadosCaso.codigo, targetStatusCode))
      .limit(1);

    if (!targetStatus) {
      throw new ActaLinkError(400, "El estado de carpeta requerido no existe");
    }

    const [updatedCarpeta] = await tx
      .update(carpetas)
      .set({
        estadoCasoId: targetStatus.id,
        version: sql`${carpetas.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(carpetas.id, input.carpetaId),
          eq(carpetas.estudioId, input.estudioId),
          eq(carpetas.version, carpeta.carpeta.version),
          eq(carpetas.sectorActualId, carpeta.carpeta.sectorActualId),
          eq(carpetas.estadoCasoId, carpeta.carpeta.estadoCasoId),
        ),
      )
      .returning();

    if (!updatedCarpeta) {
      throw new ActaLinkError(409, "La carpeta cambió, recargá");
    }

    const [realizedAudiencia] = await tx
      .update(audiencias)
      .set({ estado: AUDIENCIA_STATUS_CODES.REALIZADA, updatedAt: new Date() })
      .where(
        and(
          eq(audiencias.id, input.audienciaId),
          eq(audiencias.estudioId, input.estudioId),
          eq(audiencias.carpetaId, input.carpetaId),
          eq(audiencias.estado, AUDIENCIA_STATUS_CODES.PENDIENTE),
        ),
      )
      .returning();

    if (!realizedAudiencia) {
      throw new ActaLinkError(400, "La audiencia seleccionada ya no está pendiente");
    }

    await tx.insert(bitacoraCarpetas).values({
      carpetaId: input.carpetaId,
      usuarioId: input.usuarioId,
      accionRealizada: "acta_vinculada",
      metadata: {
        tipo_acta: acta.tipoCodigo,
        estado_anterior: carpeta.estadoCodigo,
        estado_nuevo: targetStatusCode,
      },
    });

    return linkedActa;
  });
}
