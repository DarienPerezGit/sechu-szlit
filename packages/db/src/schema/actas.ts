import { sql } from "drizzle-orm";
import { date, index, pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { estudios } from "./estudios.js";
import { carpetas } from "./carpetas.js";
import { tiposActa, estadosActa } from "./catalogos.js";

export const ACTA_TYPE_CODES = {
  AUDIENCIA_CONCILIATORIA: "audiencia_conciliatoria",
  PASE_SEGUNDA_FECHA: "pase_segunda_fecha",
  ACUERDO: "acuerdo",
  DESISTIMIENTO: "desistimiento",
} as const;

export const ACTA_STATUS_CODES = {
  PENDIENTE: "pendiente",
  FIRMADA: "firmada",
  ARCHIVADA: "archivada",
} as const;

export const actas = pgTable("actas", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  estudioId: uuid("estudio_id")
    .notNull()
    .references(() => estudios.id),
  carpetaId: uuid("carpeta_id")
    .references(() => carpetas.id),
  expediente: text("expediente"),
  tipoActaId: integer("tipo_acta_id")
    .notNull()
    .references(() => tiposActa.id),
  estadoActaId: integer("estado_acta_id")
    .notNull()
    .references(() => estadosActa.id),
  conciliadorNombre: text("conciliador_nombre"),
  conciliadorEmail: text("conciliador_email"),
  fecha: date("fecha"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => ({
  estudioCarpetaIdx: index("actas_estudio_carpeta_idx").on(
    table.estudioId,
    table.carpetaId,
  ),
  expedienteIdx: index("actas_expediente_idx").on(table.expediente),
  estudioExpedienteIdx: index("actas_estudio_expediente_idx").on(
    table.estudioId,
    table.expediente,
  ),
  estudioTipoEstadoIdx: index("actas_estudio_tipo_estado_idx").on(
    table.estudioId,
    table.tipoActaId,
    table.estadoActaId,
  ),
}));

export type Acta = typeof actas.$inferSelect;
export type NewActa = typeof actas.$inferInsert;
