/**
 * Matriz de permisos de SECHUB, en un solo lugar.
 *
 * Perfiles:
 *   - Abogado:   actúa sobre las carpetas de las que es responsable y su agenda.
 *   - Asistente: procuración. Ve todo el estudio, carga audiencias y actas y
 *                vincula actas; no crea ni modifica carpetas.
 *   - Titular:   no es un tercer rol, es un abogado con `es_titular`. Ve y
 *                modifica todo el estudio y es el único que administra el equipo.
 *
 * Las rutas llaman a estas políticas en lugar de revisar roles por su cuenta.
 * Casi todo sale de una regla: `actuaSoloSobreLoPropio`.
 *
 * Orden de los chequeos en cada ruta: autenticación (401) → rol (403) →
 * cuerpo (400, validación de esquema) → existencia (404) → acceso a ese
 * recurso (403).
 */
import { eq, or, type SQL } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  audiencias,
  carpetas,
  ROLE_CODES,
  roles,
  usuariosRoles,
  type Carpeta,
  type Database,
  type RoleCode,
  type Usuario,
} from "@sechub/db";
import { getAuthenticatedUser } from "./utils/auth.js";

export interface AuthorizationContext {
  usuarioId: string;
  rol: RoleCode | null;
  esTitular: boolean;
}

export interface Access {
  user: Usuario;
  authorization: AuthorizationContext;
}

declare module "fastify" {
  interface FastifyRequest {
    access?: Access;
  }
}

/** Carga el rol desde la base en cada pedido: un cambio de rol aplica al instante. */
export async function loadAuthorization(
  db: Database,
  user: Pick<Usuario, "id" | "esTitular">,
): Promise<AuthorizationContext> {
  const [assigned] = await db
    .select({ codigo: roles.codigo })
    .from(usuariosRoles)
    .innerJoin(roles, eq(roles.id, usuariosRoles.rolId))
    .where(eq(usuariosRoles.usuarioId, user.id))
    .limit(1);

  const rol = (Object.values(ROLE_CODES) as string[]).includes(assigned?.codigo ?? "")
    ? (assigned!.codigo as RoleCode)
    : null;

  return { usuarioId: user.id, rol, esTitular: user.esTitular };
}

// ── Perfiles ────────────────────────────────────────────────────────────────

export const esAbogado = (a: AuthorizationContext) => a.rol === ROLE_CODES.ABOGADO;
export const esAsistente = (a: AuthorizationContext) => a.rol === ROLE_CODES.ASISTENTE;
export const esTitular = (a: AuthorizationContext) => esAbogado(a) && a.esTitular;

/** La regla central: un abogado que no es titular solo actúa sobre lo propio. */
export const actuaSoloSobreLoPropio = (a: AuthorizationContext) => esAbogado(a) && !a.esTitular;

export function perfil(a: AuthorizationContext): "titular" | "abogado" | "asistente" | null {
  if (esTitular(a)) return "titular";
  if (esAbogado(a)) return "abogado";
  if (esAsistente(a)) return "asistente";
  return null;
}

// ── Carpetas ────────────────────────────────────────────────────────────────

type CarpetaOwnership = Pick<Carpeta, "abogadoResponsableId">;

const esPropia = (a: AuthorizationContext, c: CarpetaOwnership) =>
  c.abogadoResponsableId === a.usuarioId;

/** Filtro de lectura: el abogado común ve sus carpetas; los demás, todas. */
export function carpetasVisibles(a: AuthorizationContext): SQL | undefined {
  return actuaSoloSobreLoPropio(a) ? eq(carpetas.abogadoResponsableId, a.usuarioId) : undefined;
}

export const puedeVerCarpeta = (a: AuthorizationContext, c: CarpetaOwnership) =>
  !actuaSoloSobreLoPropio(a) || esPropia(a, c);

/** Abrir un expediente es tarea de abogados; el asistente no crea carpetas. */
export const puedeCrearCarpeta = (a: AuthorizationContext) => esAbogado(a);

/** Datos, estado y sector de la carpeta: el titular o su abogado responsable. */
export const puedeEditarCarpeta = (a: AuthorizationContext, c: CarpetaOwnership) =>
  esTitular(a) || (esAbogado(a) && esPropia(a, c));

/** Solo el titular asigna una carpeta a otro abogado. */
export const puedeAsignarAbogado = (a: AuthorizationContext, abogadoId: string) =>
  esTitular(a) || (esAbogado(a) && abogadoId === a.usuarioId);

/**
 * Trabajo de procuración sobre una carpeta: agendar audiencias, cargar y
 * vincular actas. Lo hacen el asistente, el titular y el abogado responsable.
 */
export const puedeTrabajarEnCarpeta = (a: AuthorizationContext, c: CarpetaOwnership) =>
  esAsistente(a) || esTitular(a) || (esAbogado(a) && esPropia(a, c));

// ── Agenda ──────────────────────────────────────────────────────────────────

/**
 * Filtro de agenda: el abogado común ve las audiencias que tiene asignadas y
 * las de sus carpetas. Requiere la consulta unida a `carpetas`.
 */
export function audienciasVisibles(a: AuthorizationContext): SQL | undefined {
  return actuaSoloSobreLoPropio(a)
    ? or(eq(audiencias.abogadoId, a.usuarioId), eq(carpetas.abogadoResponsableId, a.usuarioId))
    : undefined;
}

/** Audiencias sin carpeta: el abogado común ve solo las que tiene asignadas. */
export function audienciasSinCarpetaVisibles(a: AuthorizationContext): SQL | undefined {
  return actuaSoloSobreLoPropio(a) ? eq(audiencias.abogadoId, a.usuarioId) : undefined;
}

/** El abogado común agenda solo para sí mismo. */
export const puedeAgendarPara = (a: AuthorizationContext, abogadoId: string) =>
  !actuaSoloSobreLoPropio(a) || abogadoId === a.usuarioId;

// ── Equipo ──────────────────────────────────────────────────────────────────

export const puedeAdministrarEquipo = (a: AuthorizationContext) => esTitular(a);

// ── Middleware ──────────────────────────────────────────────────────────────

export function sendForbidden(reply: FastifyReply) {
  return reply.status(403).send({ error: "No autorizado" });
}

/**
 * Autentica (401) y exige un rol del estudio (403). Si se pasa `allowed`,
 * además filtra por perfil. Deja el contexto en `request.access`.
 */
export function requireAccess(
  db: Database,
  allowed?: (a: AuthorizationContext) => boolean,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthenticatedUser(request, reply, db);
    if (!user) return;

    const authorization = await loadAuthorization(db, user);
    if (authorization.rol === null || (allowed && !allowed(authorization))) {
      return sendForbidden(reply);
    }

    request.access = { user, authorization };
  };
}

/** Solo el titular. */
export const requireTitular = (db: Database) => requireAccess(db, esTitular);

export function getAccess(request: FastifyRequest): Access {
  if (!request.access) {
    throw new Error("Access context is unavailable");
  }
  return request.access;
}
