import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { createServer } from "../apps/api/src/index.js";

let cachedApp: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (cachedApp) return cachedApp;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is required for Vercel deployment",
    );
  }

  // Fastify app initialization with Supabase pooler
  cachedApp = await createServer(databaseUrl, "production");
  await cachedApp.ready();
  return cachedApp;
}

/**
 * Official Vercel serverless function entrypoint for Fastify.
 * Dispatches the raw HTTP request/response directly to Fastify's HTTP server.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await getApp();
  app.server.emit("request", req, res);
}
