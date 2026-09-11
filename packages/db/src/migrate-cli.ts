import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./index.js";
import { LegacyVerificationError } from "./legacy-verifier.js";
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

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required");

const pool = new Pool({ connectionString });
try {
  const result = await runMigrations(drizzle(pool, { schema }), undefined, {
    adoptExisting: forwardedArgs.includes("--adopt-existing"),
  });
  if (result.adopted) {
    console.log(`Adopted ${result.adopted} migration(s).`);
    if (result.applied) console.log(`Applied ${result.applied} migration(s).`);
  } else {
    console.log(result.applied ? `Applied ${result.applied} migration(s).` : "Database is up to date.");
  }
} catch (error) {
  if (error instanceof LegacyVerificationError || (error instanceof Error && error.message.startsWith("Migration refused:"))) throw error;
  throw new Error("Migration database connection failed. Check MIGRATION_DATABASE_URL and database availability.");
} finally {
  await pool.end();
}
