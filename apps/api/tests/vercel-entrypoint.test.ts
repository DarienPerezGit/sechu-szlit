import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import handler from "../../../api/index.js";
import { buildApp } from "../src/app.js";
import { createTestDatabase, createTestSupabaseClient } from "./helpers/db.js";

describe("Vercel Serverless Function entrypoint", () => {
  it("serves GET /api/health with status ok", async () => {
    const db = await createTestDatabase();
    const app = await buildApp({
      db,
      environment: "test",
      supabase: createTestSupabaseClient(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("handles HTTP requests through the exported Vercel serverless handler", async () => {
    // Mount the Vercel handler on a real Node HTTP server
    const server = createHttpServer((req, res) => {
      handler(req, res).catch((err) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(response.status).toBe(200);
      const data = await response.json() as { status: string };
      expect(data.status).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
