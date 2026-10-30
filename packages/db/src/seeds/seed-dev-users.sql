-- seed-dev-users.sql
-- Creates 2 fictional Supabase Auth users and links them to internal usuarios
-- records. Safe to run multiple times (IDEMPOTENT).
--
-- ┌─────────────────────────────────────────────────────────────────┐
-- │  SUPABASE ONLY — this script inserts directly into auth.users,  │
-- │  which exists only on Supabase-hosted databases.  It will fail  │
-- │  on vanilla local or CI Postgres instances that have no auth    │
-- │  schema.  Run it via the Supabase SQL editor or                 │
-- │  `supabase db seed` against a linked Supabase project.         │
-- └─────────────────────────────────────────────────────────────────┘
--
-- Fictional users (never real credentials):
--   admin@sechub.test   – will receive the ADMIN role via usuarios_roles
--   viewer@sechub.test  – no elevated role, read-only access

-- ── pgcrypto is required for crypt() / gen_salt() ────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Stable UUIDs for reproducible seeds ──────────────────────────────────────
DO $$
DECLARE
  v_admin_auth_id  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_viewer_auth_id uuid := 'a0000000-0000-0000-0000-000000000002';

  -- Pick the first estudio available to satisfy the NOT NULL FK.
  v_estudio_id     uuid;
BEGIN
  SELECT id INTO v_estudio_id FROM public.estudios LIMIT 1;

  IF v_estudio_id IS NULL THEN
    RAISE EXCEPTION 'seed-dev-users: no row found in public.estudios — run the estudios seed first';
  END IF;

  -- ── 1. Create auth identities ─────────────────────────────────────────────
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES
    (
      v_admin_auth_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@sechub.test',
      crypt('DevOnly-Admin-2024!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      v_viewer_auth_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'viewer@sechub.test',
      crypt('DevOnly-Viewer-2024!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
  ON CONFLICT (id) DO UPDATE
    SET encrypted_password     = EXCLUDED.encrypted_password,
        email_confirmed_at     = EXCLUDED.email_confirmed_at,
        confirmation_token     = COALESCE(auth.users.confirmation_token, ''),
        recovery_token         = COALESCE(auth.users.recovery_token, ''),
        email_change_token_new = COALESCE(auth.users.email_change_token_new, ''),
        email_change           = COALESCE(auth.users.email_change, ''),
        updated_at             = now();

  UPDATE auth.users
  SET confirmation_token = COALESCE(confirmation_token, ''),
      email_change = COALESCE(email_change, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      recovery_token = COALESCE(recovery_token, '')
  WHERE email IN ('admin@sechub.test', 'viewer@sechub.test');

  INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES
    (
      v_admin_auth_id,
      v_admin_auth_id::text,
      v_admin_auth_id,
      jsonb_build_object('sub', v_admin_auth_id::text, 'email', 'admin@sechub.test'),
      'email',
      now(),
      now(),
      now()
    ),
    (
      v_viewer_auth_id,
      v_viewer_auth_id::text,
      v_viewer_auth_id,
      jsonb_build_object('sub', v_viewer_auth_id::text, 'email', 'viewer@sechub.test'),
      'email',
      now(),
      now(),
      now()
    )
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. Create or update internal usuarios records ─────────────────────────
  INSERT INTO public.usuarios (
    email,
    estudio_id,
    supabase_user_id,
    activo
  )
  VALUES
    (
      'admin@sechub.test',
      v_estudio_id,
      v_admin_auth_id,
      true
    ),
    (
      'viewer@sechub.test',
      v_estudio_id,
      v_viewer_auth_id,
      true
    )
  ON CONFLICT (email) DO UPDATE
    SET supabase_user_id = EXCLUDED.supabase_user_id,
        activo           = EXCLUDED.activo;

  -- ── 3. Assign roles to internal usuarios ──────────────────────────────────
  INSERT INTO public.usuarios_roles (usuario_id, rol_id)
  SELECT u.id, r.id
  FROM public.usuarios u
  CROSS JOIN public.roles r
  WHERE u.email = 'admin@sechub.test' AND r.codigo = 'admin'
  ON CONFLICT (usuario_id, rol_id) DO NOTHING;

  INSERT INTO public.usuarios_roles (usuario_id, rol_id)
  SELECT u.id, r.id
  FROM public.usuarios u
  CROSS JOIN public.roles r
  WHERE u.email = 'viewer@sechub.test' AND r.codigo = 'lectura'
  ON CONFLICT (usuario_id, rol_id) DO NOTHING;

END $$;
