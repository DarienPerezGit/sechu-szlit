import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, text, jsonb, index } from "drizzle-orm/pg-core";
import { estudios } from "./estudios.js";

export const empleadores = pgTable("empleadores", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  estudioId: uuid("estudio_id")
    .notNull()
    .references(() => estudios.id),
  razonSocial: text("razon_social"),
  cuit: text("cuit"),
  contactoNombre: text("contacto_nombre"),
  contactoEmail: text("contacto_email"),
  contactoTelefono: text("contacto_telefono"),
  documentos: jsonb("documentos"),
  poderes: jsonb("poderes"),
  alertasVencimiento: jsonb("alertas_vencimiento"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => {
  return {
    estudioIdx: index("empleadores_estudio_idx").on(table.estudioId),
  };
});

export type Empleador = typeof empleadores.$inferSelect;
export type NewEmpleador = typeof empleadores.$inferInsert;
