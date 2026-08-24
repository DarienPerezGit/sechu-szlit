CREATE TABLE IF NOT EXISTS "roles" (
  "id" serial PRIMARY KEY NOT NULL,
  "codigo" varchar(100) NOT NULL,
  "nombre" varchar(255) NOT NULL,
  CONSTRAINT "roles_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios_roles" (
  "usuario_id" uuid NOT NULL,
  "rol_id" integer NOT NULL,
  CONSTRAINT "usuarios_roles_usuario_id_rol_id_pk" PRIMARY KEY("usuario_id", "rol_id"),
  CONSTRAINT "usuarios_roles_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id"),
  CONSTRAINT "usuarios_roles_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios_sectores" (
  "usuario_id" uuid NOT NULL,
  "sector_id" integer NOT NULL,
  CONSTRAINT "usuarios_sectores_usuario_id_sector_id_pk" PRIMARY KEY("usuario_id", "sector_id"),
  CONSTRAINT "usuarios_sectores_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id"),
  CONSTRAINT "usuarios_sectores_sector_id_sectores_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectores"("id")
);
--> statement-breakpoint
INSERT INTO "roles" ("codigo", "nombre")
VALUES
  ('admin', 'Administrador'),
  ('responsable_sector', 'Responsable de Sector'),
  ('lectura', 'Lectura')
ON CONFLICT ("codigo") DO NOTHING;
--> statement-breakpoint
INSERT INTO "usuarios_roles" ("usuario_id", "rol_id")
SELECT usuarios.id, roles.id
FROM "usuarios"
INNER JOIN "roles" ON roles.codigo = usuarios.role
ON CONFLICT ("usuario_id", "rol_id") DO NOTHING;
