CREATE TABLE IF NOT EXISTS "empleadores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"estudio_id" uuid NOT NULL,
	"razon_social" text,
	"cuit" text,
	"contacto_nombre" text,
	"contacto_email" text,
	"contacto_telefono" text,
	"documentos" jsonb,
	"poderes" jsonb,
	"alertas_vencimiento" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bitacora_carpetas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"carpeta_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"accion_realizada" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "carpetas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"estudio_id" uuid NOT NULL,
	"sector_actual_id" integer NOT NULL,
	"estado_caso_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expediente" varchar(255) NOT NULL,
	"caratula" text NOT NULL,
	"demandada" text NOT NULL,
	"empleador_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carpetas_expediente_unique" UNIQUE("expediente")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "empleadores" ADD CONSTRAINT "empleadores_estudio_id_estudios_id_fk" FOREIGN KEY ("estudio_id") REFERENCES "public"."estudios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bitacora_carpetas" ADD CONSTRAINT "bitacora_carpetas_carpeta_id_carpetas_id_fk" FOREIGN KEY ("carpeta_id") REFERENCES "public"."carpetas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bitacora_carpetas" ADD CONSTRAINT "bitacora_carpetas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carpetas" ADD CONSTRAINT "carpetas_estudio_id_estudios_id_fk" FOREIGN KEY ("estudio_id") REFERENCES "public"."estudios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carpetas" ADD CONSTRAINT "carpetas_sector_actual_id_sectores_id_fk" FOREIGN KEY ("sector_actual_id") REFERENCES "public"."sectores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carpetas" ADD CONSTRAINT "carpetas_estado_caso_id_estados_caso_id_fk" FOREIGN KEY ("estado_caso_id") REFERENCES "public"."estados_caso"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "carpetas" ADD CONSTRAINT "carpetas_empleador_id_empleadores_id_fk" FOREIGN KEY ("empleador_id") REFERENCES "public"."empleadores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "empleadores_estudio_idx" ON "empleadores" USING btree ("estudio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carpetas_estudio_sector_idx" ON "carpetas" USING btree ("estudio_id","sector_actual_id");