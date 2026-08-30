import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@sechub/db";
import { buildApp } from "./app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envDir = join(__dirname, "..", "..", "..");
const explicitDatabaseUrl = process.env.DATABASE_URL;
config({ path: join(envDir, ".env") });
config({ path: join(envDir, ".env.local"), override: true });
if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;

const port = Number(process.env.PORT ?? 3000);
const cookieSecret = process.env.COOKIE_SECRET ?? "change-me-in-production";
const environment =
  (process.env.NODE_ENV as "development" | "production" | "test") ?? "development";

export async function createServer(
  connectionString: string,
  serverEnvironment = environment,
  secret = cookieSecret,
) {
  const db = createDatabase(connectionString);
  return buildApp({ db, cookieSecret: secret, environment: serverEnvironment });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const app = await createServer(databaseUrl);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Server listening on http://localhost:${port}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
