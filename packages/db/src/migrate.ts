import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Database } from "./index.js";

export async function runMigrations(db: Database): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(__dirname, "migrations");
  
  // Read all sql files and sort them alphabetically
  const sqlFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of sqlFiles) {
    const fileSql = readFileSync(join(migrationsDir, file), "utf-8");

    // Drop Drizzle Kit marker comments: this engine sends the whole file as
    // a single multi-statement raw execute. Lines whose first non-space char
    // is `>` (e.g. the `> Custom migration:` header) are stripped because some
    // test engines do not support that syntax. Drizzle's `-->` markers start
    // with `-` and pass through: they are valid PostgreSQL single-line
    // comments and are harmless inside one db.execute() call.
    const cleaned = fileSql
      .split("\n")
      .filter((line) => !line.trim().startsWith(">"))
      .join("\n");

    if (cleaned.trim()) {
      await db.execute(sql.raw(cleaned));
    }
  }
}
