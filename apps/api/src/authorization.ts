import { sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ROLE_CODES, type Database, type Usuario } from "@sechub/db";
import { getAuthenticatedUser } from "./utils/auth.js";

export interface AuthorizationContext {
  isAdmin: boolean;
  isResponsableSector: boolean;
  sectorIds: Set<number>;
}

export interface WriteAuthorization {
  user: Usuario;
  authorization: AuthorizationContext;
}

declare module "fastify" {
  interface FastifyRequest {
    writeAuthorization?: WriteAuthorization;
  }
}

interface AuthorizationRow {
  codigo: string;
  sectorId: number | null;
}

export async function loadAuthorization(
  db: Database,
  usuarioId: string,
): Promise<AuthorizationContext> {
  const result = await db.execute(sql<AuthorizationRow>`
    SELECT roles.codigo, usuarios_sectores.sector_id AS "sectorId"
    FROM usuarios_roles
    INNER JOIN roles ON roles.id = usuarios_roles.rol_id
    LEFT JOIN usuarios_sectores ON usuarios_sectores.usuario_id = usuarios_roles.usuario_id
    WHERE usuarios_roles.usuario_id = ${usuarioId}
  `);
  const rows = result.rows as unknown as AuthorizationRow[];

  return {
    isAdmin: rows.some((row) => row.codigo === ROLE_CODES.ADMIN),
    isResponsableSector: rows.some((row) => row.codigo === ROLE_CODES.RESPONSABLE_SECTOR),
    sectorIds: new Set(
      rows.flatMap((row) => row.sectorId === null ? [] : [row.sectorId]),
    ),
  };
}

export function canWrite(context: AuthorizationContext): boolean {
  return context.isAdmin || context.isResponsableSector;
}

export function canWriteSector(
  context: AuthorizationContext,
  sectorId: number,
): boolean {
  return context.isAdmin || (
    context.isResponsableSector && context.sectorIds.has(sectorId)
  );
}

export function sendForbidden(reply: FastifyReply) {
  return reply.status(403).send({ error: "No autorizado" });
}

export function requireWriteAuthorization(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const authorization = await loadAuthorization(db, user.id);
    if (!canWrite(authorization)) {
      return sendForbidden(reply);
    }

    request.writeAuthorization = { user, authorization };
  };
}

export function getWriteAuthorization(request: FastifyRequest): WriteAuthorization {
  if (!request.writeAuthorization) {
    throw new Error("Write authorization context is unavailable");
  }

  return request.writeAuthorization;
}
