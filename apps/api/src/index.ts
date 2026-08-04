import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, runMigrations } from "@sechub/db";
import { buildApp } from "./app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envDir = join(__dirname, "..", "..");
config({ path: join(envDir, ".env") });
config({ path: join(envDir, ".env.local"), override: true });

const port = Number(process.env.PORT ?? 3000);
const cookieSecret = process.env.COOKIE_SECRET ?? "change-me-in-production";
const environment =
  (process.env.NODE_ENV as "development" | "production" | "test") ??
  "development";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

async function main() {
  const db = createDatabase(databaseUrl);
  await runMigrations(db);

  const app = await buildApp({
    db,
    cookieSecret,
    environment,
  });

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Server listening on http://localhost:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
