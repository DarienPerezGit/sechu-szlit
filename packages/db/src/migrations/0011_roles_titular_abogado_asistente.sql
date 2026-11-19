-- Roles del mundo real: Abogado, Asistente (procuración) y Titular.
--
-- Reemplaza el modelo por sector de 0005 (admin / responsable_sector / lectura),
-- que repartía permisos por etapa del pipeline en lugar de por persona y caso.
--
--   abogado   – actúa sobre las carpetas de las que es responsable y su agenda.
--   asistente – procuración: ve todo el estudio, carga audiencias y actas y
--               vincula actas; no crea ni modifica carpetas.
--   titular   – NO es un tercer rol: es un abogado con usuarios.es_titular = true.
--               Ve y modifica todo el estudio y administra el equipo. Un estudio
--               puede tener varios titulares.
--
-- El sector deja de ser un permiso: sigue siendo la etapa del pipeline de cada
-- carpeta (carpetas.sector_actual_id), pero ya no decide quién puede escribir.

-- 1. Roles nuevos
INSERT INTO "roles" ("codigo", "nombre")
VALUES
  ('abogado', 'Abogado'),
  ('asistente', 'Asistente (procuración)')
ON CONFLICT ("codigo") DO NOTHING;
--> statement-breakpoint

-- 2. Titular = abogado con permiso de administración del estudio
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "es_titular" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

UPDATE "usuarios" SET "es_titular" = true
WHERE "id" IN (
  SELECT ur.usuario_id
  FROM usuarios_roles ur
  INNER JOIN roles r ON r.id = ur.rol_id
  WHERE r.codigo = 'admin'
);
--> statement-breakpoint

-- 3. Convertir asignaciones: admin y responsable_sector pasan a abogado.
--    Un usuario solo de lectura NO pasa a asistente: el asistente agenda y
--    vincula actas (lo que cambia el estado del caso), así que sería darle
--    permisos que nunca tuvo. Queda desactivado y sin rol, para que el titular
--    decida a mano qué perfil le corresponde.
INSERT INTO "usuarios_roles" ("usuario_id", "rol_id")
SELECT DISTINCT ur.usuario_id, nuevo.id
FROM usuarios_roles ur
INNER JOIN roles r ON r.id = ur.rol_id
CROSS JOIN (SELECT id FROM roles WHERE codigo = 'abogado') AS nuevo
WHERE r.codigo IN ('admin', 'responsable_sector')
ON CONFLICT ("usuario_id", "rol_id") DO NOTHING;
--> statement-breakpoint

UPDATE "usuarios" SET "activo" = false
WHERE "id" IN (
  SELECT ur.usuario_id
  FROM usuarios_roles ur
  INNER JOIN roles r ON r.id = ur.rol_id
  GROUP BY ur.usuario_id
  HAVING bool_and(r.codigo = 'lectura')
);
--> statement-breakpoint

DELETE FROM "usuarios_roles"
WHERE "rol_id" IN (SELECT id FROM roles WHERE codigo IN ('admin', 'responsable_sector', 'lectura'));
--> statement-breakpoint

DELETE FROM "roles" WHERE "codigo" IN ('admin', 'responsable_sector', 'lectura');
--> statement-breakpoint

-- 4. Un rol por usuario
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_roles_un_rol_por_usuario" ON "usuarios_roles" ("usuario_id");
--> statement-breakpoint

-- 5. Cada carpeta tiene un abogado responsable. Las existentes se asignan al
--    titular del estudio (o, si no hay, al primer abogado). No depende del
--    seed de demo: después de esta migración ninguna carpeta queda sin
--    responsable, y si no se puede asignar la migración falla entera.
ALTER TABLE "carpetas" ADD COLUMN IF NOT EXISTS "abogado_responsable_id" uuid;
--> statement-breakpoint

UPDATE "carpetas" c
SET "abogado_responsable_id" = (
  SELECT u.id
  FROM usuarios u
  INNER JOIN usuarios_roles ur ON ur.usuario_id = u.id
  INNER JOIN roles r ON r.id = ur.rol_id
  WHERE u.estudio_id = c.estudio_id AND r.codigo = 'abogado'
  ORDER BY u.es_titular DESC, u.created_at, u.id
  LIMIT 1
)
WHERE c."abogado_responsable_id" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM carpetas WHERE abogado_responsable_id IS NULL) THEN
    RAISE EXCEPTION 'roles_titular_abogado_asistente: hay carpetas en un estudio sin ningún abogado; asigne un abogado antes de migrar';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "carpetas" ALTER COLUMN "abogado_responsable_id" SET NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "carpetas"
    ADD CONSTRAINT "carpetas_abogado_responsable_id_usuarios_id_fk"
    FOREIGN KEY ("abogado_responsable_id") REFERENCES "public"."usuarios"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "carpetas_estudio_abogado_idx" ON "carpetas" ("estudio_id", "abogado_responsable_id");
--> statement-breakpoint

-- 6. El permiso por sector desaparece
DROP TABLE IF EXISTS "usuarios_sectores";
