CREATE TABLE IF NOT EXISTS "estudios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nombre" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'lectura' NOT NULL,
	"estudio_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estados_caso" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" varchar(100) NOT NULL,
	"nombre" varchar(255) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "estados_caso_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sectores" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" varchar(100) NOT NULL,
	"nombre" varchar(255) NOT NULL,
	"es_vertical" boolean DEFAULT false NOT NULL,
	"orden_pipeline" integer,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sectores_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tipos_audiencia" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" varchar(100) NOT NULL,
	"nombre" varchar(255) NOT NULL,
	"color" varchar(50),
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tipos_audiencia_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_estudio_id_estudios_id_fk" FOREIGN KEY ("estudio_id") REFERENCES "public"."estudios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
-- NOTE: estudios has no UNIQUE constraint, so ON CONFLICT DO NOTHING would
-- re-insert on every run. The WHERE NOT EXISTS guard enforces the business
-- contract "seed exactly one estudio" asserted by tests/schema.test.ts.
INSERT INTO "estudios" ("nombre")
SELECT 'Estudio Szlit'
WHERE NOT EXISTS (SELECT 1 FROM "estudios");

--> statement-breakpoint
INSERT INTO "sectores" ("codigo", "nombre", "orden_pipeline", "es_vertical", "activo")
VALUES 
  ('comunicaciones', 'Comunicaciones', 1, false, true),
  ('seclo', 'SECLO', 2, false, true),
  ('redaccion', 'Redacción', 3, false, true),
  ('procesal', 'Procesal', 4, false, true),
  ('accidentes', 'Accidentes', NULL, true, true),
  ('mediaciones_civiles', 'Mediaciones civiles', NULL, true, true)
ON CONFLICT (codigo) DO NOTHING;

--> statement-breakpoint
INSERT INTO "estados_caso" ("codigo", "nombre", "activo")
VALUES 
  ('en_tramite', 'En trámite', true),
  ('conciliado', 'Conciliado', true),
  ('desestimado', 'Desestimado', true),
  ('archivado', 'Archivado', true)
ON CONFLICT (codigo) DO NOTHING;

--> statement-breakpoint
INSERT INTO "tipos_audiencia" ("codigo", "nombre", "color", "activo")
VALUES 
  ('seclo', 'SECLO', '#3b82f6', true),
  ('judicial', 'Judicial', '#ef4444', true),
  ('accidente', 'Accidente', '#f59e0b', true),
  ('comunicacion', 'Comunicación', '#10b981', true),
  ('mediacion', 'Mediación', '#8b5cf6', true),
  ('consulta', 'Consulta', '#6b7280', true)
ON CONFLICT (codigo) DO NOTHING;
