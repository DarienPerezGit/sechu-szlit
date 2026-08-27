import { pgTable, serial, varchar, boolean, integer } from "drizzle-orm/pg-core";

export const sectores = pgTable("sectores", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  esVertical: boolean("es_vertical").default(false).notNull(),
  ordenPipeline: integer("orden_pipeline"),
  activo: boolean("activo").default(true).notNull(),
});

export const estadosCaso = pgTable("estados_caso", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  activo: boolean("activo").default(true).notNull(),
});

export const tiposAudiencia = pgTable("tipos_audiencia", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  color: varchar("color", { length: 50 }),
  activo: boolean("activo").default(true).notNull(),
});

export const tiposActa = pgTable("tipos_acta", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  activo: boolean("activo").default(true).notNull(),
});

export const estadosActa = pgTable("estados_acta", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 100 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  activo: boolean("activo").default(true).notNull(),
});

export type Sector = typeof sectores.$inferSelect;
export type NewSector = typeof sectores.$inferInsert;

export type EstadoCaso = typeof estadosCaso.$inferSelect;
export type NewEstadoCaso = typeof estadosCaso.$inferInsert;

export type TipoAudiencia = typeof tiposAudiencia.$inferSelect;
export type NewTipoAudiencia = typeof tiposAudiencia.$inferInsert;

export type TipoActa = typeof tiposActa.$inferSelect;
export type NewTipoActa = typeof tiposActa.$inferInsert;

export type EstadoActa = typeof estadosActa.$inferSelect;
export type NewEstadoActa = typeof estadosActa.$inferInsert;
