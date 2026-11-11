import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { setSupabaseClient } from "./lib/supabase";
import { fakeJsonResponse } from "./test-helpers/fake-response";
import { createFakeSupabaseClient } from "./test-helpers/fake-supabase";

type MockedFetch = ReturnType<typeof vi.fn>;

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
    createFakeSupabaseClient({ sessionToken: null });
    render(<App />);

    expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ingresar/ })).toBeTruthy();
  });

  it("shows the authenticated identity from /api/auth/me with the Bearer token", async () => {
    createFakeSupabaseClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async (_path: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer tok-1");
        return fakeJsonResponse({ status: 200, body: JSON.stringify(ME_PAYLOAD) });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("SECHUB · Estudio Szlit")).toBeTruthy();
    expect(screen.getByText("abogada@estudio.com")).toBeTruthy();
    expect(screen.getByText("ADMIN")).toBeTruthy();
    expect(screen.getByText("LECTURA")).toBeTruthy();
  });

  it("shows the deactivated account state on API 403", async () => {
    createFakeSupabaseClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () =>
        fakeJsonResponse({ status: 403, body: '{"error":"Cuenta desactivada"}' }),
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
    const { signOut } = createFakeSupabaseClient({ sessionToken: "tok-expired" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () => fakeJsonResponse({ status: 401, body: "{}" }));
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
    const { capturedAuthHandlers } = createFakeSupabaseClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () =>
        fakeJsonResponse({ status: 200, body: JSON.stringify(ME_PAYLOAD) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("SECHUB · Estudio Szlit")).toBeTruthy();

    // At least one onAuthStateChange subscription is registered by App.
    expect(capturedAuthHandlers.length).toBeGreaterThan(0);

    await act(async () => {
      for (const handler of capturedAuthHandlers) {
        handler("SIGNED_OUT", null);
      }
    });

    expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
  });

  it("shows the expiry notice when the session is lost mid-use (failed refresh)", async () => {
    const { capturedAuthHandlers } = createFakeSupabaseClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () =>
        fakeJsonResponse({ status: 200, body: JSON.stringify(ME_PAYLOAD) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("SECHUB · Estudio Szlit")).toBeTruthy();

    // The library has no dedicated refresh-failure event: when a background
    // token refresh fails it removes the dead session and emits SIGNED_OUT.
    await act(async () => {
      for (const handler of capturedAuthHandlers) {
        handler("SIGNED_OUT", null);
      }
    });

    expect(
      await screen.findByText("Tu sesión expiró. Iniciá sesión nuevamente."),
    ).toBeTruthy();
  });

  it("does not show the expiry notice after a manual logout", async () => {
    const { signOut } = createFakeSupabaseClient({ sessionToken: "tok-1" });
    const fetchMock: MockedFetch = vi
      .fn()
      .mockImplementation(async () =>
        fakeJsonResponse({ status: 200, body: JSON.stringify(ME_PAYLOAD) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(await screen.findByText("SECHUB · Estudio Szlit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByText("Iniciar sesión")).toBeTruthy();
    expect(screen.queryByText("Tu sesión expiró. Iniciá sesión nuevamente.")).toBeNull();
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });
});
