import type { FastifyInstance } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import {
  type Database,
  ROLE_CODES,
  roles,
  usuarios,
  usuariosRoles,
  type RoleCode,
} from "@sechub/db";
import { getAccess, requireAccess, requireTitular } from "../authorization.js";
import { UUID_REGEX } from "../utils/auth.js";

export interface EquipoPluginOptions {
  db: Database;
}

/**
 * Equipo del estudio. Cualquier perfil lo consulta (para asignar abogados a
 * carpetas y audiencias); solo el titular lo administra.
 */
export async function equipoRoutes(app: FastifyInstance, opts: EquipoPluginOptions) {
  const { db } = opts;

  const listar = (estudioId: string, soloActivos: boolean) =>
    db
      .select({
        id: usuarios.id,
        email: usuarios.email,
        rol: roles.codigo,
        esTitular: usuarios.esTitular,
        activo: usuarios.activo,
      })
      .from(usuarios)
      .leftJoin(usuariosRoles, eq(usuariosRoles.usuarioId, usuarios.id))
      .leftJoin(roles, eq(roles.id, usuariosRoles.rolId))
      .where(soloActivos
        ? and(eq(usuarios.estudioId, estudioId), eq(usuarios.activo, true))
        : eq(usuarios.estudioId, estudioId))
      .orderBy(usuarios.email);

  // GET /api/equipo — miembros activos, con su rol
  app.get("/equipo", { preValidation: requireAccess(db) }, async (request, reply) => {
    const { user } = getAccess(request);
    return reply.status(200).send(await listar(user.estudioId, true));
  });

  // PATCH /api/equipo/:id — solo el titular cambia rol, titularidad o baja
  app.patch<{
    Params: { id: string };
    Body: { rol?: RoleCode; esTitular?: boolean; activo?: boolean };
  }>("/equipo/:id", {
    preValidation: requireTitular(db),
    schema: {
      body: {
        type: "object",
        minProperties: 1,
        additionalProperties: false,
        properties: {
          rol: { type: "string", enum: Object.values(ROLE_CODES) },
          esTitular: { type: "boolean" },
          activo: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const { user } = getAccess(request);
    const { id } = request.params;
    if (!UUID_REGEX.test(id)) {
      return reply.status(400).send({ error: "ID de usuario inválido" });
    }

    const [miembro] = (await listar(user.estudioId, false)).filter((m) => m.id === id);
    if (!miembro) {
      return reply.status(404).send({ error: "Usuario no encontrado" });
    }

    const rol = request.body.rol ?? (miembro.rol as RoleCode | null);
    const esTitular = request.body.esTitular ?? miembro.esTitular;
    const activo = request.body.activo ?? miembro.activo;

    if (esTitular && rol !== ROLE_CODES.ABOGADO) {
      return reply.status(400).send({ error: "Solo un abogado puede ser titular" });
    }

    const quedaSinTitular = await db.transaction(async (tx) => {
      // El estudio nunca queda sin un titular activo.
      const sigueSiendoTitular = esTitular && activo && rol === ROLE_CODES.ABOGADO;
      if (miembro.esTitular && miembro.activo && !sigueSiendoTitular) {
        const otros = await tx
          .select({ id: usuarios.id })
          .from(usuarios)
          .where(and(
            eq(usuarios.estudioId, user.estudioId),
            eq(usuarios.esTitular, true),
            eq(usuarios.activo, true),
            ne(usuarios.id, id),
          ))
          .for("update");
        if (otros.length === 0) return true;
      }

      await tx
        .update(usuarios)
        .set({ esTitular, activo, updatedAt: new Date() })
        .where(eq(usuarios.id, id));

      if (request.body.rol !== undefined && request.body.rol !== miembro.rol) {
        const [nuevo] = await tx.select().from(roles).where(eq(roles.codigo, request.body.rol)).limit(1);
        await tx.delete(usuariosRoles).where(eq(usuariosRoles.usuarioId, id));
        await tx.insert(usuariosRoles).values({ usuarioId: id, rolId: nuevo.id });
      }
      return false;
    });

    if (quedaSinTitular) {
      return reply.status(409).send({ error: "El estudio debe tener al menos un titular activo" });
    }

    const [actualizado] = (await listar(user.estudioId, false)).filter((m) => m.id === id);
    return reply.status(200).send(actualizado);
  });
}
