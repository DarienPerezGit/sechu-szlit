CREATE TABLE IF NOT EXISTS "audiencias" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"estudio_id" uuid NOT NULL,
	"carpeta_id" uuid,
	"abogado_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"hora" time NOT NULL,
	"tipo_audiencia_id" integer NOT NULL,
	"link_reunion" text,
	"link_detalle" text,
	"notas_internas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audiencias" ADD CONSTRAINT "audiencias_estudio_id_estudios_id_fk" FOREIGN KEY ("estudio_id") REFERENCES "public"."estudios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audiencias" ADD CONSTRAINT "audiencias_carpeta_id_carpetas_id_fk" FOREIGN KEY ("carpeta_id") REFERENCES "public"."carpetas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audiencias" ADD CONSTRAINT "audiencias_abogado_id_usuarios_id_fk" FOREIGN KEY ("abogado_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audiencias" ADD CONSTRAINT "audiencias_tipo_audiencia_id_tipos_audiencia_id_fk" FOREIGN KEY ("tipo_audiencia_id") REFERENCES "public"."tipos_audiencia"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audiencias_estudio_fecha_hora_idx" ON "audiencias" USING btree ("estudio_id","fecha","hora");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audiencias_estudio_carpeta_idx" ON "audiencias" USING btree ("estudio_id","carpeta_id");