-- Issue #26: Supabase grants hardening.
--
-- Supabase's default privileges grant ALL on every table to `anon` and
-- `authenticated`. That exposes the whole schema to the frontend, so this
-- migration takes every table to zero and then re-opens only the catalogs the
-- browser genuinely needs, read-only.
--
-- Authorization stays in the application layer (Fastify + Drizzle). This
-- migration is defense in depth, not a replacement for app-level checks, and
-- it is deliberately NOT row-level security: SECHUB is currently monotenant.
--
-- `anon` and `authenticated` only exist on Supabase-managed databases. The
-- local and CI Postgres images are vanilla, so every statement below is
-- guarded by a pg_roles check instead of failing on a missing role.

-- Revoke everything first, then grant back. Doing it in this order matters:
-- a GRANT SELECT on top of Supabase's default ALL is a no-op, so a catalog
-- table that was never revoked stays fully writable. `estudios` is revoked
-- like any other table on purpose: it is the tenant boundary, not a lookup
-- value, so the browser has no business reading it directly.
DO $$
DECLARE
  supabase_role text;
  target_table text;
  revoked_tables text[] := ARRAY[
    '__sechub_migrations',
    'actas',
    'audiencias',
    'bitacora_carpetas',
    'carpetas',
    'empleadores',
    'estudios',
    'sessions',
    'usuarios',
    'usuarios_roles',
    'usuarios_sectores',
    'sectores',
    'estados_caso',
    'tipos_audiencia',
    'tipos_acta',
    'estados_acta',
    'roles'
  ];
BEGIN
  FOREACH supabase_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = supabase_role) THEN
      CONTINUE;
    END IF;

    FOREACH target_table IN ARRAY revoked_tables LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', target_table, supabase_role);
    END LOOP;

    -- Identity column sequences stay unusable for the frontend roles.
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', supabase_role);
  END LOOP;
END
$$;

-- Catalog tables the frontend legitimately needs. `roles` stays here so the UI
-- can render role labels; it is the permission catalogue, so it is read-only.
DO $$
DECLARE
  catalog_table text;
  read_only_tables text[] := ARRAY[
    'sectores',
    'estados_caso',
    'tipos_audiencia',
    'tipos_acta',
    'estados_acta',
    'roles'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  FOREACH catalog_table IN ARRAY read_only_tables LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', catalog_table);
  END LOOP;
END
$$;

-- A one-time REVOKE is not enough: Supabase re-applies ALL on every table it
-- creates afterwards through ALTER DEFAULT PRIVILEGES. Without this, the next
-- migration that adds a table silently reopens the exposure.
DO $$
DECLARE
  supabase_role text;
BEGIN
  FOREACH supabase_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = supabase_role) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', supabase_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', supabase_role);
  END LOOP;
END
$$;
