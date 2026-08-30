import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./index.js";
import { runMigrations } from "./migrate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const inheritedEnv = { ...process.env };
config({ path: join(root, ".env") });
config({ path: join(root, ".env.local"), override: true });
Object.assign(process.env, inheritedEnv);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString });
try {
  const result = await runMigrations(drizzle(pool, { schema }));
  console.log(result.applied ? `Applied ${result.applied} migration(s).` : "Database is up to date.");
} finally {
  await pool.end();
}
