import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createServer } from "../src/index.js";

const adminUrl = process.env.TEST_DATABASE_URL;
const databases: string[] = [];

async function query(url: string, text: string, values: unknown[] = []) {
  if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

async function createIsolatedDatabase(): Promise<string> {
  if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
  const name = `sechub_api_start_${process.pid}_${Date.now()}`;
  await query(adminUrl, `CREATE DATABASE "${name}"`);
  databases.push(name);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

afterEach(async () => {
  if (!adminUrl) return;
  for (const name of databases.splice(0)) {
    await query(adminUrl, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [name]);
    await query(adminUrl, `DROP DATABASE "${name}"`);
  }
});

describe("Fastify startup", () => {
  it("does not run migrations", async () => {
    const url = await createIsolatedDatabase();
    const app = await createServer(url, "test");
    await app.ready();
    const tables = await query(url, `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema()`);
    expect(tables.rows[0].count).toBe(0);
    await app.close();
  });
});
