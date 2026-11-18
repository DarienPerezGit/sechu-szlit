import { createClient } from "@supabase/supabase-js";

/**
 * Alta de cuentas en el proveedor de identidad. Es una interfaz para que las
 * pruebas usen un doble y la app real use Supabase Auth con la clave secreta,
 * que vive solo en el servidor (nunca en el navegador).
 */
export interface AuthAdmin {
  crearCuenta(email: string, password: string): Promise<{ id: string }>;
}

export class AuthAdminError extends Error {
  constructor(
    public readonly statusCode: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AuthAdminError";
  }
}

export function createSupabaseAuthAdmin(
  supabaseUrl: string | undefined,
  secretKey: string | undefined,
): AuthAdmin | null {
  if (!supabaseUrl || !secretKey) return null;
  const client = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async crearCuenta(email, password) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        const yaExiste = /already|registered|exists/i.test(error?.message ?? "");
        throw new AuthAdminError(
          yaExiste ? 409 : 400,
          yaExiste ? "Ya existe una cuenta con ese email" : `No se pudo crear la cuenta: ${error?.message ?? "sin detalle"}`,
        );
      }
      return { id: data.user.id };
    },
  };
}
