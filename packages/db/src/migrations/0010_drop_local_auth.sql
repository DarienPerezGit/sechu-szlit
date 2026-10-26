-- Issue #31: atomic cutover from local authentication to Supabase Auth.
--
-- Supabase Auth is now the only identity provider: credentials, sessions and
-- refresh tokens live in `auth.*`. The local copies are removed so that no
-- deployable revision can authenticate a request without a Supabase token.
--
--   public.sessions            – local signed-cookie sessions (replaced by
--                                Supabase access tokens validated per request).
--   public.usuarios.password_hash – local Argon2 credentials.
--
-- DESTRUCTIVE and not reversible by a down-migration: dropping the column
-- discards every stored local password hash and dropping the table discards
-- every local session. Take a backup first (docs/supabase-backup-restore.md).
--
-- Nothing is CASCADEd on purpose. If a view, function or foreign key still
-- depends on either object, the migration fails loudly instead of silently
-- removing that dependent.

-- 1. Local sessions (sessions.usuario_id -> usuarios.id is the only FK; nothing
--    references sessions, so the plain DROP is safe).
DROP TABLE IF EXISTS public.sessions;

-- 2. Local password hashes.
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS password_hash;
