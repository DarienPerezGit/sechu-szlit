> Custom migration: bootstrap core tables and seed the default studio.

CREATE TABLE IF NOT EXISTS "estudios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nombre" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'lectura' NOT NULL,
	"estudio_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_estudio_id_estudios_id_fk" FOREIGN KEY ("estudio_id") REFERENCES "estudios"("id") ON DELETE no action
);

CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE cascade
);

INSERT INTO "estudios" ("nombre")
SELECT 'Estudio Szlit'
WHERE NOT EXISTS (SELECT 1 FROM "estudios");
