import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, varchar, text, integer, jsonb, index } from "drizzle-orm/pg-core";
import { estudios } from "./estudios.js";
import { sectores, estadosCaso } from "./catalogos.js";
import { empleadores } from "./empleadores.js";
import { usuarios } from "./usuarios.js";

export const carpetas = pgTable("carpetas", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  estudioId: uuid("estudio_id")
    .notNull()
    .references(() => estudios.id),
  sectorActualId: integer("sector_actual_id")
    .notNull()
    .references(() => sectores.id),
  estadoCasoId: integer("estado_caso_id")
    .notNull()
    .references(() => estadosCaso.id),
  version: integer("version").default(1).notNull(),
  expediente: varchar("expediente", { length: 255 }).unique().notNull(),
  caratula: text("caratula").notNull(),
  demandada: text("demandada").notNull(),
  empleadorId: uuid("empleador_id")
    .references(() => empleadores.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => {
  return {
    estudioSectorIdx: index("carpetas_estudio_sector_idx").on(table.estudioId, table.sectorActualId),
    estudioEstadoIdx: index("carpetas_estudio_estado_idx").on(table.estudioId, table.estadoCasoId),
  };
});

export const bitacoraCarpetas = pgTable("bitacora_carpetas", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  carpetaId: uuid("carpeta_id")
    .notNull()
    .references(() => carpetas.id, { onDelete: "cascade" }),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  accionRealizada: text("accion_realizada").notNull(),
  fecha: timestamp("fecha", { withTimezone: true })
    .defaultNow()
    .notNull(),
  metadata: jsonb("metadata"),
}, (table) => {
  return {
    carpetaIdx: index("bitacora_carpetas_carpeta_idx").on(table.carpetaId),
    usuarioIdx: index("bitacora_carpetas_usuario_idx").on(table.usuarioId),
  };
});

export type Carpeta = typeof carpetas.$inferSelect;
export type NewCarpeta = typeof carpetas.$inferInsert;

export type BitacoraCarpeta = typeof bitacoraCarpetas.$inferSelect;
export type NewBitacoraCarpeta = typeof bitacoraCarpetas.$inferInsert;
