import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@sechub/db";
import { buildApp } from "./app.js";
import { createSupabaseClient } from "./utils/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envDir = join(__dirname, "..", "..", "..");
const explicitDatabaseUrl = process.env.DATABASE_URL;
config({ path: join(envDir, ".env") });
config({ path: join(envDir, ".env.local"), override: true });
if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;

const port = Number(process.env.PORT ?? 3000);
const environment =
  (process.env.NODE_ENV as "development" | "production" | "test") ?? "development";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;

export async function createServer(
  connectionString: string,
  serverEnvironment = environment,
) {
  const db = createDatabase(connectionString);
  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);
  return buildApp({
    db,
    environment: serverEnvironment,
    supabase,
  });
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
