import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const estudios = pgTable("estudios", {
  id: uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Estudio = typeof estudios.$inferSelect;
export type NewEstudio = typeof estudios.$inferInsert;
