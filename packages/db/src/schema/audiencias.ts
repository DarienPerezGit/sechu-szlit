import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, text, integer, date, time, index } from "drizzle-orm/pg-core";
import { estudios } from "./estudios.js";
import { carpetas } from "./carpetas.js";
import { usuarios } from "./usuarios.js";
import { tiposAudiencia } from "./catalogos.js";

export const audiencias = pgTable("audiencias", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  estudioId: uuid("estudio_id")
    .notNull()
    .references(() => estudios.id),
  carpetaId: uuid("carpeta_id")
    .references(() => carpetas.id),
  abogadoId: uuid("abogado_id")
    .notNull()
    .references(() => usuarios.id),
  fecha: date("fecha").notNull(),
  hora: time("hora").notNull(),
  tipoAudienciaId: integer("tipo_audiencia_id")
    .notNull()
    .references(() => tiposAudiencia.id),
  linkReunion: text("link_reunion"),
  linkDetalle: text("link_detalle"),
  notasInternas: text("notas_internas"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => {
  return {
    estudioFechaHoraIdx: index("audiencias_estudio_fecha_hora_idx").on(
      table.estudioId,
      table.fecha,
      table.hora,
    ),
    estudioCarpetaIdx: index("audiencias_estudio_carpeta_idx").on(
      table.estudioId,
      table.carpetaId,
    ),
  };
});

export type Audiencia = typeof audiencias.$inferSelect;
export type NewAudiencia = typeof audiencias.$inferInsert;
