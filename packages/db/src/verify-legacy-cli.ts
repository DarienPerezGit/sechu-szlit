import { config } from "dotenv";
import { Client } from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LegacyVerificationError, validateLegacyManifest, verifyLegacy } from "./legacy-verifier.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const inheritedEnv = { ...process.env };
config({ path: join(root, ".env") }); config({ path: join(root, ".env.local"), override: true }); Object.assign(process.env, inheritedEnv);
class UsageError extends Error {}
function manifestArgument(args: string[]): string {
  const index = args.indexOf("--manifest");
  if (index < 0 || !args[index + 1] || args.length !== 2) throw new UsageError("usage: pnpm db:verify-legacy --manifest <checked-in manifest path>");
  return args[index + 1];
}
function safeMessage(error: unknown): string {
  if (error instanceof UsageError || error instanceof LegacyVerificationError) return error.message;
  return "database inspection failed; verify database access and schema";
}

try {
  const manifest = manifestArgument(process.argv.slice(2)); validateLegacyManifest(manifest);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new LegacyVerificationError("DATABASE_URL is required");
  const client = new Client({ connectionString });
  try { await client.connect(); } catch { throw new LegacyVerificationError("database connection failed; check DATABASE_URL and PostgreSQL availability"); }
  try { await verifyLegacy(client, manifest); } finally { await client.end(); }
  console.log("Legacy public schema verified; no data or migration metadata was changed.");
} catch (error) {
  console.error(`Legacy verification failed: ${safeMessage(error)}`); process.exitCode = 1;
}
