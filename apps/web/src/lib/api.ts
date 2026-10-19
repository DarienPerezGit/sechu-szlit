import { getSupabaseClient } from "./supabase";

/** Error thrown for any non-2xx API response, including 403 (deactivated). */
export class ApiError extends Error {
  readonly status: number;
  /** `error` field of the JSON body, when the API sent one. */
  readonly serverMessage: string | null;

  constructor(status: number, body: string | null) {
    let serverMessage: string | null = null;
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (typeof parsed.error === "string") serverMessage = parsed.error;
      } catch {
        // Non-JSON body: keep the generic message.
      }
    }
    super(serverMessage ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/** True when the API answered 403 "Cuenta desactivada". */
export function isDeactivatedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403;
}

async function authorizedRequest(
  path: string,
  init: RequestInit,
  accessToken: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(path, { ...init, headers });
}

async function handleResponse<T>(response: Response): Promise<T> {
  const bodyText = await response.text();
  if (!response.ok) {
    throw new ApiError(response.status, bodyText || null);
  }
  if (!bodyText) return undefined as unknown as T;
  return JSON.parse(bodyText) as T;
}

/**
 * Fetch against the Fastify API with the current Supabase access token.
 *
 * - Always goes through relative `/api/*` paths (same origin); the web app
 *   never talks to domain tables via PostgREST.
 * - On 401, makes exactly one refresh attempt (the token may have expired)
 *   and retries the request once with the fresh token before failing.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const client = getSupabaseClient();
  const { data } = await client.auth.getSession();
  const sessionToken = data.session?.access_token ?? null;

  const response = await authorizedRequest(path, init, sessionToken);

  if (response.status === 401) {
    const { data: refreshed } = await client.auth.refreshSession();
    const freshToken = refreshed.session?.access_token ?? null;
    if (freshToken && freshToken !== sessionToken) {
      const retry = await authorizedRequest(path, init, freshToken);
      return handleResponse<T>(retry);
    }
  }

  return handleResponse<T>(response);
}
