import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Database } from "./index.js";

export async function runMigrations(db: Database): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationPath = join(__dirname, "migrations", "0000_seed.sql");
  const fileSql = readFileSync(migrationPath, "utf-8");

  // Strip comments because some test engines (pg-mem) do not support the
  // `>` comment syntax used by Drizzle Kit marker comments.
  const cleaned = fileSql
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  await db.execute(sql.raw(cleaned));
}
