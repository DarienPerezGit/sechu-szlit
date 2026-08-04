import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

function setupPoolErrors(pool: Pool) {
  pool.on("error", (err) => {
    console.error("Unexpected error on idle PostgreSQL client:", err);
  });
}

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
  });
  setupPoolErrors(pool);
  return drizzle(pool, { schema });
}

export function createDatabaseFromPool(pool: Pool): Database {
  setupPoolErrors(pool);
  return drizzle(pool, { schema });
}

export * from "./schema/index.js";
export { schema };
export * from "./migrate.js";
