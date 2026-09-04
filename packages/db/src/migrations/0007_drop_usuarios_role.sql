DO $$
DECLARE
  has_unknown_role boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuarios'
      AND column_name = 'role'
  ) THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1
        FROM public.usuarios AS u
        LEFT JOIN public.roles AS r ON r.codigo = u.role
        WHERE r.id IS NULL
      )
    $query$ INTO has_unknown_role;

    IF has_unknown_role THEN
      RAISE EXCEPTION 'cannot drop usuarios.role: unknown role code detected';
    END IF;

    EXECUTE $query$
      INSERT INTO public.usuarios_roles (usuario_id, rol_id)
      SELECT u.id, r.id
      FROM public.usuarios AS u
      INNER JOIN public.roles AS r ON r.codigo = u.role
      ON CONFLICT (usuario_id, rol_id) DO NOTHING
    $query$;

    EXECUTE 'ALTER TABLE public.usuarios DROP COLUMN IF EXISTS role';
  END IF;
END $$;
