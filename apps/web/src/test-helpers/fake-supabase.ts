import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mock } from "vitest";
import { vi } from "vitest";
import { setSupabaseClient } from "../lib/supabase";

export interface FakeAuthError {
  message: string;
  status?: number;
}

export interface FakeSupabaseClientOptions {
  /** Access token returned by getSession(); null/omitted means no session. */
  sessionToken?: string | null;
  /** Access token refreshSession() resolves with; omitted means no token. */
  refreshedToken?: string | null;
  /** Resolved value of signInWithPassword(); default is a successful sign-in. */
  signInResult?: { data: unknown; error: FakeAuthError | null };
}

export interface FakeSupabaseClientHandles {
  getSession: Mock;
  refreshSession: Mock;
  signInWithPassword: Mock;
  signOut: Mock;
  onAuthStateChange: Mock;
  /** Callbacks registered through onAuthStateChange, to simulate events. */
  capturedAuthHandlers: ((...args: unknown[]) => void)[];
}

/**
 * Installs a hand-rolled fake Supabase client covering the app's auth surface
 * — getSession, refreshSession, signInWithPassword, signOut and
 * onAuthStateChange (registrations captured in `capturedAuthHandlers`) — and
 * returns the spies so tests can inspect calls or simulate events.
 */
export function createFakeSupabaseClient(
  options: FakeSupabaseClientOptions = {},
): FakeSupabaseClientHandles {
  const capturedAuthHandlers: ((...args: unknown[]) => void)[] = [];
  const getSession = vi.fn().mockResolvedValue({
    data: {
      session: options.sessionToken
        ? { access_token: options.sessionToken }
        : null,
    },
    error: null,
  });
  const refreshSession = vi.fn().mockResolvedValue({
    data: {
      session: options.refreshedToken
        ? { access_token: options.refreshedToken }
        : null,
    },
    error: null,
  });
  const signInWithPassword = vi
    .fn()
    .mockResolvedValue(options.signInResult ?? { data: {}, error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
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
      refreshSession,
      signInWithPassword,
      signOut,
    },
  };
  setSupabaseClient(fake as unknown as SupabaseClient);

  return {
    getSession,
    refreshSession,
    signInWithPassword,
    signOut,
    onAuthStateChange,
    capturedAuthHandlers,
  };
}
