import type { FastifyInstance } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import {
  carpetas,
  type Database,
  ROLE_CODES,
  roles,
  usuarios,
  usuariosRoles,
  type RoleCode,
} from "@sechub/db";
import {
  esTitular,
  getAccess,
  requireAccess,
  requireTitular,
  veTodoElEquipo,
} from "../authorization.js";
import { UUID_REGEX, PG_UNIQUE_VIOLATION } from "../utils/auth.js";
import { AuthAdminError, type AuthAdmin } from "../utils/auth-admin.js";

export interface EquipoPluginOptions {
  db: Database;
  authAdmin: AuthAdmin | null;
}

/**
 * Equipo del estudio. Lo consultan quienes asignan trabajo (titular y
 * asistente); el abogado común solo se ve a sí mismo. Solo el titular lo
 * administra: alta, rol, titularidad y baja.
 */
export async function equipoRoutes(app: FastifyInstance, opts: EquipoPluginOptions) {
  const { db, authAdmin } = opts;

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

  // GET /api/equipo — miembros activos con su rol. ?incluirInactivos=true
  // (solo el titular) suma las bajas, para la pestaña de administración.
  app.get<{ Querystring: { incluirInactivos?: string } }>(
    "/equipo",
    { preValidation: requireAccess(db) },
    async (request, reply) => {
      const { user, authorization } = getAccess(request);
      const conBajas = request.query.incluirInactivos === "true" && esTitular(authorization);
      const miembros = await listar(user.estudioId, !conBajas);
      return reply
        .status(200)
        .send(veTodoElEquipo(authorization) ? miembros : miembros.filter((m) => m.id === user.id));
    },
  );

  // POST /api/equipo — el titular da de alta a un integrante: crea la cuenta
  // en Supabase Auth y su perfil con un único rol.
  app.post<{
    Body: { email: string; password: string; rol: RoleCode; esTitular?: boolean };
  }>("/equipo", {
    preValidation: requireTitular(db),
    schema: {
      body: {
        type: "object",
        required: ["email", "password", "rol"],
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email", maxLength: 255 },
          password: { type: "string", minLength: 8, maxLength: 72 },
          rol: { type: "string", enum: Object.values(ROLE_CODES) },
          esTitular: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const { user } = getAccess(request);
    const email = request.body.email.trim().toLowerCase();
    const { password, rol } = request.body;
    const esNuevoTitular = request.body.esTitular ?? false;

    if (esNuevoTitular && rol !== ROLE_CODES.ABOGADO) {
      return reply.status(400).send({ error: "Solo un abogado puede ser titular" });
    }
    if (!authAdmin) {
      return reply.status(503).send({ error: "El alta de usuarios no está configurada en este servidor (falta SUPABASE_SECRET_KEY)" });
    }

    const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (existente) {
      return reply.status(409).send({ error: "Ya existe un integrante con ese email" });
    }

    let cuenta: { id: string };
    try {
      cuenta = await authAdmin.crearCuenta(email, password);
    } catch (error) {
      if (error instanceof AuthAdminError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }

    try {
      await db.transaction(async (tx) => {
        const [nuevo] = await tx
          .insert(usuarios)
          .values({ email, estudioId: user.estudioId, supabaseUserId: cuenta.id, esTitular: esNuevoTitular })
          .returning();
        const [codigo] = await tx.select().from(roles).where(eq(roles.codigo, rol)).limit(1);
        await tx.insert(usuariosRoles).values({ usuarioId: nuevo.id, rolId: codigo.id });
      });
    } catch (error: any) {
      if (error?.code === PG_UNIQUE_VIOLATION) {
        return reply.status(409).send({ error: "Ya existe un integrante con ese email" });
      }
      throw error;
    }

    const [creado] = (await listar(user.estudioId, false)).filter((m) => m.email === email);
    return reply.status(201).send(creado);
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

    // Una carpeta siempre la lleva un abogado: antes de que deje de serlo,
    // el titular le reasigna sus carpetas.
    if (miembro.rol === ROLE_CODES.ABOGADO && rol !== ROLE_CODES.ABOGADO) {
      const [aCargo] = await db
        .select({ id: carpetas.id })
        .from(carpetas)
        .where(and(eq(carpetas.estudioId, user.estudioId), eq(carpetas.abogadoResponsableId, id)))
        .limit(1);
      if (aCargo) {
        return reply.status(409).send({ error: "Tiene carpetas a su cargo: reasignalas a otro abogado antes de cambiarle el perfil" });
      }
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
