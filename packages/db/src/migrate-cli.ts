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

const args = process.argv.slice(2);
const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
if (forwardedArgs.some((arg) => arg !== "--adopt-existing") || forwardedArgs.length > 1) {
  throw new Error("usage: pnpm db:migrate [-- --adopt-existing]");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString });
try {
  const result = await runMigrations(drizzle(pool, { schema }), undefined, {
    adoptExisting: forwardedArgs.includes("--adopt-existing"),
  });
  if (result.adopted) console.log(`Adopted ${result.adopted} migration(s).`);
  else console.log(result.applied ? `Applied ${result.applied} migration(s).` : "Database is up to date.");
} finally {
  await pool.end();
}
