export interface FakeResponseInit {
  status: number;
  body?: string;
}

/**
 * Minimal Response stub for fake *fetch* implementations: enough for
 * `handleResponse`-style consumers that only read `ok`, `status` and `text()`.
 */
export function fakeJsonResponse({ status, body }: FakeResponseInit): Response {
  const ok = status >= 200 && status < 300;
  return { ok, status, text: async () => body ?? "" } as unknown as Response;
}
