import { integer, primaryKey, pgTable, serial, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { usuarios } from "./usuarios.js";

/**
 * Roles del estudio. El titular no es un rol: es un abogado con
 * `usuarios.es_titular = true` (ver migración 0011).
 */
export const ROLE_CODES = {
  ABOGADO: "abogado",
  ASISTENTE: "asistente",
} as const;

export type RoleCode = typeof ROLE_CODES[keyof typeof ROLE_CODES];

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
});

export const usuariosRoles = pgTable("usuarios_roles", {
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  rolId: integer("rol_id")
    .notNull()
    .references(() => roles.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.usuarioId, table.rolId] }),
  unRolPorUsuario: uniqueIndex("usuarios_roles_un_rol_por_usuario").on(table.usuarioId),
}));

export type Rol = typeof roles.$inferSelect;
export type NewRol = typeof roles.$inferInsert;
export type UsuarioRol = typeof usuariosRoles.$inferSelect;
export type NewUsuarioRol = typeof usuariosRoles.$inferInsert;
