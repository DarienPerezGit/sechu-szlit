CREATE TABLE IF NOT EXISTS "tipos_acta" (
  "id" serial PRIMARY KEY NOT NULL,
  "codigo" varchar(100) NOT NULL,
  "nombre" varchar(255) NOT NULL,
  "activo" boolean DEFAULT true NOT NULL,
  CONSTRAINT "tipos_acta_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estados_acta" (
  "id" serial PRIMARY KEY NOT NULL,
  "codigo" varchar(100) NOT NULL,
  "nombre" varchar(255) NOT NULL,
  "activo" boolean DEFAULT true NOT NULL,
  CONSTRAINT "estados_acta_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
INSERT INTO "tipos_acta" ("codigo", "nombre", "activo")
VALUES
  ('audiencia_conciliatoria', 'Audiencia conciliatoria', true),
  ('pase_segunda_fecha', 'Pase a segunda fecha', true),
  ('acuerdo', 'Acuerdo', true),
  ('desistimiento', 'Desistimiento', true)
ON CONFLICT ("codigo") DO NOTHING;
--> statement-breakpoint
INSERT INTO "estados_acta" ("codigo", "nombre", "activo")
VALUES
  ('pendiente', 'Pendiente', true),
  ('firmada', 'Firmada', true),
  ('archivada', 'Archivada', true)
ON CONFLICT ("codigo") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "actas" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "estudio_id" uuid NOT NULL,
  "carpeta_id" uuid,
  "expediente" text,
  "tipo_acta_id" integer NOT NULL,
  "estado_acta_id" integer NOT NULL,
  "conciliador_nombre" text,
  "conciliador_email" text,
  "fecha" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "actas" ADD CONSTRAINT "actas_estudio_id_estudios_id_fk"
    FOREIGN KEY ("estudio_id") REFERENCES "public"."estudios"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "actas" ADD CONSTRAINT "actas_carpeta_id_carpetas_id_fk"
    FOREIGN KEY ("carpeta_id") REFERENCES "public"."carpetas"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "actas" ADD CONSTRAINT "actas_tipo_acta_id_tipos_acta_id_fk"
    FOREIGN KEY ("tipo_acta_id") REFERENCES "public"."tipos_acta"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "actas" ADD CONSTRAINT "actas_estado_acta_id_estados_acta_id_fk"
    FOREIGN KEY ("estado_acta_id") REFERENCES "public"."estados_acta"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actas_estudio_carpeta_idx"
  ON "actas" USING btree ("estudio_id", "carpeta_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actas_expediente_idx"
  ON "actas" USING btree ("expediente");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actas_estudio_expediente_idx"
  ON "actas" USING btree ("estudio_id", "expediente");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actas_estudio_tipo_estado_idx"
  ON "actas" USING btree ("estudio_id", "tipo_acta_id", "estado_acta_id");
--> statement-breakpoint
ALTER TABLE "audiencias" ADD COLUMN IF NOT EXISTS "estado" text;
--> statement-breakpoint
UPDATE "audiencias" SET "estado" = 'pendiente' WHERE "estado" IS NULL;
--> statement-breakpoint
ALTER TABLE "audiencias" ALTER COLUMN "estado" SET DEFAULT 'pendiente';
--> statement-breakpoint
ALTER TABLE "audiencias" ALTER COLUMN "estado" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "audiencias" ADD CONSTRAINT "audiencias_estado_check"
    CHECK ("estado" IN ('pendiente', 'realizada'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audiencias_estudio_estado_idx"
  ON "audiencias" USING btree ("estudio_id", "estado");
