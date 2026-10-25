import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, isDeactivatedError } from "./api";
import { setSupabaseClient } from "./supabase";
import { fakeJsonResponse } from "../test-helpers/fake-response";
import { createFakeSupabaseClient } from "../test-helpers/fake-supabase";

function fetchCallsWithAuthorization(
  fetchMock: ReturnType<typeof vi.fn>,
): (string | null)[] {
  return fetchMock.mock.calls.map((call: unknown[]) => {
    const init = call[1] as RequestInit | undefined;
    return new Headers(init?.headers).get("Authorization");
  });
}

afterEach(() => {
  setSupabaseClient(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("attaches the current access token as Authorization: Bearer", async () => {
    const { getSession } = createFakeSupabaseClient({ sessionToken: "token-1" });
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async (_path: unknown, _init?: RequestInit) =>
          fakeJsonResponse({ status: 200, body: '{"ok":true}' }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<Record<string, unknown>>("/api/auth/me");

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchCallsWithAuthorization(fetchMock)[0]).toBe("Bearer token-1");
  });

  it("sends no Authorization header when there is no session", async () => {
    createFakeSupabaseClient({ sessionToken: null });
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => fakeJsonResponse({ status: 200, body: "{}" }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/catalogos");

    expect(fetchCallsWithAuthorization(fetchMock)).toEqual([null]);
  });

  it("performs exactly one refresh attempt and retries once on 401", async () => {
    createFakeSupabaseClient({
      sessionToken: "expired-token",
      refreshedToken: "fresh-token",
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_path: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        return headers.get("Authorization") === "Bearer fresh-token"
          ? fakeJsonResponse({ status: 200, body: '{"user":{"id":"u1"}}' })
          : fakeJsonResponse({ status: 401, body: '{}' });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ user: { id: string } }>("/api/auth/me");

    expect(result.user.id).toBe("u1");
    const auths = fetchCallsWithAuthorization(fetchMock);
    expect(auths).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  });

  it("throws ApiError 401 when the refresh attempt yields no fresh token", async () => {
    createFakeSupabaseClient({
      sessionToken: "expired-token",
      refreshedToken: null,
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => fakeJsonResponse({ status: 401, body: '{}' }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = apiFetch("/api/auth/me");
    await expect(promise).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the session and retries on 401 even without an initial token", async () => {
    const { refreshSession } = createFakeSupabaseClient({
      sessionToken: null,
      refreshedToken: "fresh-token",
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_path: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        return headers.get("Authorization") === "Bearer fresh-token"
          ? fakeJsonResponse({ status: 200, body: '{"ok":true}' })
          : fakeJsonResponse({ status: 401, body: "{}" });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<Record<string, unknown>>("/api/catalogos");

    expect(result).toEqual({ ok: true });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchCallsWithAuthorization(fetchMock)).toEqual([
      null,
      "Bearer fresh-token",
    ]);
  });

  /** One-shot body: fetch consumes it, so a raw resend only sees it drained. */
  function createOneShotBody(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }

  async function readBodyText(body: unknown): Promise<string> {
    return new Response(body as ReadableStream).text();
  }

  it("resends a one-shot body on the 401 refresh retry", async () => {
    createFakeSupabaseClient({
      sessionToken: "expired-token",
      refreshedToken: "fresh-token",
    });
    const bodiesByCall: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_path: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (init?.body !== undefined) {
          // Simulates fetch consuming a stream body exactly once.
          bodiesByCall.push(await readBodyText(init.body as ReadableStream));
        }
        return headers.get("Authorization") === "Bearer fresh-token"
          ? fakeJsonResponse({ status: 200, body: '{"ok":true}' })
          : fakeJsonResponse({ status: 401, body: "{}" });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<Record<string, unknown>>("/api/items", {
      method: "POST",
      body: createOneShotBody("payload"),
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodiesByCall).toEqual(["payload", "payload"]);
  });

  it("surfaces 403 as a deactivation error with the server message", async () => {
    createFakeSupabaseClient({ sessionToken: "token" });
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        fakeJsonResponse({ status: 403, body: '{"error":"Cuenta desactivada"}' }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const error = (await apiFetch("/api/auth/me").catch((caught: unknown) => caught)) as unknown;
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.serverMessage).toBe("Cuenta desactivada");
    expect(isDeactivatedError(apiError)).toBe(true);
    expect(isDeactivatedError(new Error("other"))).toBe(false);
  });
});
