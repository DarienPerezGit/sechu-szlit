-- seed-dev-users.sql
-- Creates the fictional demo team in Supabase Auth and links each identity to
-- an internal usuarios record with its role. Safe to run multiple times
-- (IDEMPOTENT).
--
-- ┌─────────────────────────────────────────────────────────────────┐
-- │  SUPABASE ONLY — this script inserts directly into auth.users,  │
-- │  which exists only on Supabase-hosted databases.  It will fail  │
-- │  on vanilla local or CI Postgres instances that have no auth    │
-- │  schema.  Run it via the Supabase SQL editor or                 │
-- │  `supabase db seed` against a linked Supabase project.         │
-- └─────────────────────────────────────────────────────────────────┘
--
-- Fictional team (never real people or credentials). Requires migration 0011.
--   admin@sechub.test      – Titular: abogado con es_titular; ve todo y administra el equipo
--   abogado1@sechub.test   – Abogado: solo sus carpetas y su agenda
--   abogado2@sechub.test   – Abogado: solo sus carpetas y su agenda
--   asistente@sechub.test  – Asistente (procuración): ve todo, agenda y vincula actas,
--                            no abre ni edita carpetas
--
-- The former read-only demo user viewer@sechub.test is deactivated (soft delete).

DO $$
DECLARE
  v_estudio_id uuid;
  m record;
BEGIN
  -- Pick the first estudio available to satisfy the NOT NULL FK.
  SELECT id INTO v_estudio_id FROM public.estudios LIMIT 1;

  IF v_estudio_id IS NULL THEN
    RAISE EXCEPTION 'seed-dev-users: no row found in public.estudios — run the estudios seed first';
  END IF;

  FOR m IN
    SELECT * FROM (VALUES
      ('a0000000-0000-0000-0000-000000000001'::uuid, 'admin@sechub.test',     'DevOnly-Admin-2024!',     'abogado',   true),
      ('a0000000-0000-0000-0000-000000000003'::uuid, 'abogado1@sechub.test',  'DevOnly-Abogado1-2024!',  'abogado',   false),
      ('a0000000-0000-0000-0000-000000000004'::uuid, 'abogado2@sechub.test',  'DevOnly-Abogado2-2024!',  'abogado',   false),
      ('a0000000-0000-0000-0000-000000000005'::uuid, 'asistente@sechub.test', 'DevOnly-Asistente-2024!', 'asistente', false)
    ) AS t(auth_id, email, password, rol, es_titular)
  LOOP
    -- ── 1. Auth identity ──────────────────────────────────────────────────
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    VALUES (
      m.auth_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      m.email, crypt(m.password, gen_salt('bf')), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    )
    ON CONFLICT (id) DO UPDATE
      SET encrypted_password     = EXCLUDED.encrypted_password,
          email_confirmed_at     = EXCLUDED.email_confirmed_at,
          confirmation_token     = COALESCE(auth.users.confirmation_token, ''),
          recovery_token         = COALESCE(auth.users.recovery_token, ''),
          email_change_token_new = COALESCE(auth.users.email_change_token_new, ''),
          email_change           = COALESCE(auth.users.email_change, ''),
          updated_at             = now();

    INSERT INTO auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    VALUES (
      m.auth_id, m.auth_id::text, m.auth_id,
      jsonb_build_object('sub', m.auth_id::text, 'email', m.email),
      'email', now(), now(), now()
    )
    ON CONFLICT (id) DO NOTHING;

    -- ── 2. Internal profile ───────────────────────────────────────────────
    INSERT INTO public.usuarios (email, estudio_id, supabase_user_id, activo, es_titular)
    VALUES (m.email, v_estudio_id, m.auth_id, true, m.es_titular)
    ON CONFLICT (email) DO UPDATE
      SET supabase_user_id = EXCLUDED.supabase_user_id,
          activo           = true,
          es_titular       = EXCLUDED.es_titular;

    -- ── 3. Exactly one role ───────────────────────────────────────────────
    DELETE FROM public.usuarios_roles
    WHERE usuario_id = (SELECT id FROM public.usuarios WHERE email = m.email);

    INSERT INTO public.usuarios_roles (usuario_id, rol_id)
    SELECT u.id, r.id
    FROM public.usuarios u
    CROSS JOIN public.roles r
    WHERE u.email = m.email AND r.codigo = m.rol;
  END LOOP;

  -- The old read-only user has no place in the new model.
  UPDATE public.usuarios SET activo = false, es_titular = false
  WHERE email = 'viewer@sechub.test';
END $$;
