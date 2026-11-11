import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Database } from "@sechub/db";
import { actasRoutes } from "./routes/actas.js";
import { authRoutes } from "./routes/auth.js";
import { catalogosRoutes } from "./routes/catalogos.js";
import { carpetasRoutes } from "./routes/carpetas.js";
import { audienciasRoutes } from "./routes/audiencias.js";
import { equipoRoutes } from "./routes/equipo.js";

declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient | null;
  }
}

export interface AppDependencies {
  db: Database;
  environment: "development" | "production" | "test";
  webRoot?: string;
  /** Supabase client for Bearer token validation. */
  supabase?: SupabaseClient | null;
}

export async function buildApp(deps: AppDependencies) {
  const supabase = deps.supabase ?? null;

  const app = Fastify({
    logger: deps.environment === "development",
  });

  app.decorate("supabase", supabase);

  await app.register(fastifyStatic, {
    root: deps.webRoot ??
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "web",
        "dist",
      ),
    prefix: "/",
  });

  app.get("/api/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  app.register(authRoutes, {
    prefix: "/api/auth",
    db: deps.db,
  });

  app.register(catalogosRoutes, {
    prefix: "/api",
    db: deps.db,
  });

  app.register(carpetasRoutes, {
    prefix: "/api",
    db: deps.db,
  });

  app.register(audienciasRoutes, {
    prefix: "/api",
    db: deps.db,
  });

  app.register(actasRoutes, {
    prefix: "/api",
    db: deps.db,
  });

  app.register(equipoRoutes, {
    prefix: "/api",
    db: deps.db,
  });

  return app;
}
