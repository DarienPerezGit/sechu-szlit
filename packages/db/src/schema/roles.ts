import { integer, primaryKey, pgTable, serial, uuid, varchar } from "drizzle-orm/pg-core";
import { sectores } from "./catalogos.js";
import { usuarios } from "./usuarios.js";

export const ROLE_CODES = {
  ADMIN: "admin",
  RESPONSABLE_SECTOR: "responsable_sector",
  LECTURA: "lectura",
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
}));

export const usuariosSectores = pgTable("usuarios_sectores", {
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  sectorId: integer("sector_id")
    .notNull()
    .references(() => sectores.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.usuarioId, table.sectorId] }),
}));

export type Rol = typeof roles.$inferSelect;
export type NewRol = typeof roles.$inferInsert;
export type UsuarioRol = typeof usuariosRoles.$inferSelect;
export type NewUsuarioRol = typeof usuariosRoles.$inferInsert;
export type UsuarioSector = typeof usuariosSectores.$inferSelect;
export type NewUsuarioSector = typeof usuariosSectores.$inferInsert;
