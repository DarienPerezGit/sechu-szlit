import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Database } from "@sechub/db";
import { authRoutes } from "./routes/auth.js";
import { catalogosRoutes } from "./routes/catalogos.js";
import { carpetasRoutes } from "./routes/carpetas.js";
import { audienciasRoutes } from "./routes/audiencias.js";

export interface AppDependencies {
  db: Database;
  cookieSecret: string;
  environment: "development" | "production" | "test";
  webRoot?: string;
}

export async function buildApp(deps: AppDependencies) {
  const isProduction = deps.environment === "production";

  const app = Fastify({
    logger: deps.environment === "development",
  });

  await app.register(fastifyCookie, {
    secret: deps.cookieSecret,
    parseOptions: {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: isProduction,
    },
  });

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

  app.register(authRoutes, {
    prefix: "/api/auth",
    db: deps.db,
    isProduction,
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

  return app;
}
