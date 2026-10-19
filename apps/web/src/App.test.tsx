import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen, act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { setSupabaseClient } from "./lib/supabase";

type MockedFetch = ReturnType<typeof vi.fn>;

function createFakeClient(options: { sessionToken: string | null }) {
  const capturedAuthHandlers: ((...args: unknown[]) => void)[] = [];
  const getSession = vi.fn().mockResolvedValue({
    data: {
      session: options.sessionToken
        ? { access_token: options.sessionToken }
        : null,
    },
    error: null,
  });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const refreshSession = vi.fn().mockResolvedValue({
    data: { session: null },
    error: null,
  });
  const onAuthStateChange = vi
    .fn()
    .mockImplementation((callback: (...args: unknown[]) => void) => {
      capturedAuthHandlers.push(callback);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

  const fake = {
    auth: {
      getSession,
      onAuthStateChange,
      signOut,
      signInWithPassword: vi.fn(),
      refreshSession,
    },
  };
  setSupabaseClient(fake as unknown as SupabaseClient);
  return { getSession, signOut, capturedAuthHandlers };
}

function fakeApiResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const ME_PAYLOAD = {
  user: {
    id: "u-1",
    email: "abogada@estudio.com",
    role: "ADMIN",
    roles: ["ADMIN", "LECTURA"],
    estudioId: "e-1",
  },
};

afterEach(() => {
  setSupabaseClient(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App auth gate", () => {
  it("lands on the login form when there is no session", async () => {
    createFakeClient({ sessionToken: null });
    render(<App />);

    expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ingresar/ })).toBeTruthy();
  });

  it("shows the authenticated identity from /api/auth/me with the Bearer token", async () => {
    createFakeClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async (_path: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer tok-1");
        return fakeApiResponse(200, JSON.stringify(ME_PAYLOAD));
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("Sesión iniciada")).toBeTruthy();
    expect(screen.getByText("abogada@estudio.com")).toBeTruthy();
    expect(screen.getByText("ADMIN")).toBeTruthy();
    expect(screen.getByText("LECTURA")).toBeTruthy();
  });

  it("shows the deactivated account state on API 403", async () => {
    createFakeClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () =>
        fakeApiResponse(403, '{"error":"Cuenta desactivada"}'),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByText(
        "Tu cuenta está desactivada. Contactá al administrador del estudio.",
      ),
    ).toBeTruthy();
  });

  it("falls back to login with an expiry notice when the API rejects the stored session", async () => {
    const { signOut } = createFakeClient({ sessionToken: "tok-expired" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () => fakeApiResponse(401, "{}"));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByText("Tu sesión expiró. Iniciá sesión nuevamente."),
    ).toBeTruthy();
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("returns to the login form when the client emits SIGNED_OUT", async () => {
    const { capturedAuthHandlers } = createFakeClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () =>
        fakeApiResponse(200, JSON.stringify(ME_PAYLOAD)),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("Sesión iniciada")).toBeTruthy();

    // At least one onAuthStateChange subscription is registered by App.
    expect(capturedAuthHandlers.length).toBeGreaterThan(0);

    await act(async () => {
      for (const handler of capturedAuthHandlers) {
        handler("SIGNED_OUT", null);
      }
    });

    expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
  });
});
