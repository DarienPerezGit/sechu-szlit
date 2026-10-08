-- Issue #28: Link usuarios to Supabase Auth.
--
-- Adds two columns to `usuarios`:
--   supabase_user_id uuid UNIQUE  – nullable; populated when a local profile is
--                                   linked to a Supabase Auth identity.
--   activo boolean NOT NULL DEFAULT true – soft-delete flag; never physically
--                                          delete a user, set activo = false.
--
-- The FK from supabase_user_id → auth.users(id) is conditional: auth.users
-- exists only on Supabase-hosted databases. Local/CI Postgres is vanilla and
-- has no auth schema. The guard pattern is identical to migration 0008.
--
-- Rejection of unauthenticated or inactive users is enforced at the application
-- layer (Fastify middleware, issue #29). No triggers or functions are added here.
--
-- Sessions and password_hash are intentionally untouched; those are handled by
-- issues #29-#31.

-- 1. Add supabase_user_id (idempotent via exception handler)
DO $$
BEGIN
  ALTER TABLE public.usuarios ADD COLUMN supabase_user_id uuid;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- 2. Unique constraint on supabase_user_id (idempotent)
DO $$
BEGIN
  ALTER TABLE public.usuarios
    ADD CONSTRAINT usuarios_supabase_user_id_unique UNIQUE (supabase_user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint already exists
END $$;

-- 3. Add activo (idempotent via exception handler)
DO $$
BEGIN
  ALTER TABLE public.usuarios ADD COLUMN activo boolean NOT NULL DEFAULT true;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- 4. FK to auth.users — only on Supabase-hosted databases.
--    Guarded by pg_namespace, same pattern as 0008.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    -- Only add the FK if it doesn't already exist.
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND constraint_name = 'usuarios_supabase_user_id_fkey'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
      ALTER TABLE public.usuarios
        ADD CONSTRAINT usuarios_supabase_user_id_fkey
        FOREIGN KEY (supabase_user_id)
        REFERENCES auth.users(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END $$;
