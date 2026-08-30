import { afterEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const explicitDatabaseUrl = process.env.DATABASE_URL;
config({ path: join(repoRoot, ".env.local"), override: true });
if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;
const adminUrl = process.env.TEST_DATABASE_URL;
const databases: string[] = [];

function requireAdminUrl(): string {
  if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
  return adminUrl;
}

async function query(url: string, text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function createDatabase(): Promise<string> {
  const name = `sechub_migration_${process.pid}_${Date.now()}_${databases.length}`;
  await query(requireAdminUrl(), `CREATE DATABASE "${name}"`);
  databases.push(name);
  const url = new URL(requireAdminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

async function invokeMigration(url: string, testDatabaseUrl?: string) {
  try {
    const windows = process.platform === "win32";
    const env = { ...process.env, DATABASE_URL: url };
    if (testDatabaseUrl) env.TEST_DATABASE_URL = testDatabaseUrl;
    else delete env.TEST_DATABASE_URL;
    const result = await execFile(
      windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
      windows ? ["/d", "/s", "/c", "pnpm db:migrate"] : ["db:migrate"],
      { cwd: repoRoot, env },
    );
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return { status: result.code ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
}

afterEach(async () => {
  for (const name of databases.splice(0)) {
    await query(requireAdminUrl(),
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [name]);
    await query(requireAdminUrl(), `DROP DATABASE "${name}"`);
  }
});

describe("pnpm db:migrate", () => {
  it("uses DATABASE_URL when both migration variables are present", async () => {
    const databaseUrl = await createDatabase();
    const testDatabaseUrl = await createDatabase();
    const result = await invokeMigration(databaseUrl, testDatabaseUrl);

    expect(result.status).toBe(0);
    expect((await query(databaseUrl, `SELECT count(*)::int AS count FROM "__sechub_migrations"`)).rows[0].count)
      .toBe(7);
    expect((await query(testDatabaseUrl, `SELECT to_regclass('__sechub_migrations') AS name`)).rows[0].name)
      .toBeNull();
  });

  it("applies the complete history once and repeats as an exact no-op", async () => {
    const url = await createDatabase();
    const first = await invokeMigration(url);
    expect(first.status).toBe(0);

    const records = await query(url,
      `SELECT filename, sha256 FROM "__sechub_migrations" ORDER BY id`);
    expect(records.rows.map((row) => row.filename)).toEqual([
      "0000_aberrant_dakota_north.sql",
      "0001_thankful_meggan.sql",
      "0002_wild_doctor_faustus.sql",
      "0003_wealthy_iron_monger.sql",
      "0004_brief_mesmero.sql",
      "0005_role_sector_permissions.sql",
      "0006_actas_orphan_tray.sql",
    ]);
    expect(records.rows.every((row) => /^[a-f0-9]{64}$/.test(row.sha256))).toBe(true);

    const second = await invokeMigration(url);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("up to date");
    expect((await query(url,
      `SELECT filename, sha256 FROM "__sechub_migrations" ORDER BY id`)).rows)
      .toEqual(records.rows);
  });

  it("fails closed for a metadata-free existing schema without writing metadata", async () => {
    const url = await createDatabase();
    await query(url, `CREATE TABLE legacy_table (id integer PRIMARY KEY)`);
    const result = await invokeMigration(url);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("explicit legacy adoption path planned for PR 2");
    const metadata = await query(url, `SELECT to_regclass('__sechub_migrations') AS name`);
    expect(metadata.rows[0].name).toBeNull();
  });

  it("serializes concurrent fresh invocations", async () => {
    const url = await createDatabase();
    const results = await Promise.all([invokeMigration(url), invokeMigration(url)]);
    expect(results.map((result) => result.status)).toEqual([0, 0]);
    expect(results.filter((result) => result.stdout.includes("Applied 7 migration(s)")).length).toBe(1);
    expect(results.filter((result) => result.stdout.includes("up to date")).length).toBe(1);
    const records = await query(url, `SELECT count(*)::int AS count FROM "__sechub_migrations"`);
    expect(records.rows[0].count).toBe(7);
  });

  it("rolls back migration effects and metadata when SQL fails", async () => {
    const url = await createDatabase();
    expect((await invokeMigration(url)).status).toBe(0);
    await query(url, `
      DELETE FROM "__sechub_migrations" WHERE filename = '0006_actas_orphan_tray.sql';
      DROP TABLE actas, tipos_acta, estados_acta;
      CREATE TABLE actas (id uuid PRIMARY KEY);
    `);
    const result = await invokeMigration(url);
    expect(result.status).toBe(1);
    const records = await query(url, `SELECT count(*)::int AS count FROM "__sechub_migrations"`);
    const tables = await query(url, `SELECT to_regclass('tipos_acta') AS tipos, to_regclass('estados_acta') AS estados`);
    expect(records.rows[0].count).toBe(6);
    expect(tables.rows[0]).toEqual({ tipos: null, estados: null });
  });

  it("rejects integrity mismatches before executing pending migrations and non-contiguous history", async () => {
    const integrityUrl = await createDatabase();
    expect((await invokeMigration(integrityUrl)).status).toBe(0);
    await query(integrityUrl, `
      DELETE FROM "__sechub_migrations" WHERE filename = '0006_actas_orphan_tray.sql';
      DROP TABLE actas, tipos_acta, estados_acta;
      UPDATE "__sechub_migrations" SET sha256 = repeat('0', 64) WHERE id = 1;
    `);
    const integrity = await invokeMigration(integrityUrl);
    expect(integrity.status).toBe(1);
    expect(`${integrity.stdout}${integrity.stderr}`).toContain("integrity mismatch");
    const pendingEffect = await query(integrityUrl,
      `SELECT to_regclass('tipos_acta') AS name`);
    expect(pendingEffect.rows[0].name).toBeNull();

    const gapUrl = await createDatabase();
    expect((await invokeMigration(gapUrl)).status).toBe(0);
    await query(gapUrl, `DELETE FROM "__sechub_migrations" WHERE filename = '0003_wealthy_iron_monger.sql'`);
    const gap = await invokeMigration(gapUrl);
    expect(gap.status).toBe(1);
    expect(`${gap.stdout}${gap.stderr}`).toContain("non-contiguous");
  });
});
