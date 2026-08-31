import { afterEach, describe, expect, it } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";

const execFile = promisify(execFileCallback);
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const manifest = "packages/db/src/migrations/manifests/legacy-public-v1.json";
const manifestPath = join(repoRoot, manifest);
const databases: string[] = [];
const migrationDir = join(repoRoot, "packages/db/src/migrations");
const migrations = readdirSync(migrationDir).filter((filename) => filename.endsWith(".sql")).sort();

function localAdminUrl(): string | undefined {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) && (!url.port || url.port === "5432") ? raw : undefined;
}
async function query(url: string, text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: url }); await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}
async function database(apply = true): Promise<string> {
  const admin = localAdminUrl(); if (!admin) throw new Error("local TEST_DATABASE_URL is required");
  const name = `sechub_legacy_${process.pid}_${Date.now()}_${databases.length}`;
  await query(admin, `CREATE DATABASE "${name}"`); databases.push(name);
  const url = new URL(admin); url.pathname = `/${name}`;
  if (apply) {
    const client = new Client({ connectionString: url.toString() }); await client.connect();
    try {
      for (const filename of migrations) {
        const sql = readFileSync(join(repoRoot, "packages/db/src/migrations", filename), "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) await client.query(statement);
      }
    } finally { await client.end(); }
  }
  return url.toString();
}
async function invoke(url: string, manifestArg: string | null = manifest, extraEnv: Record<string, string> = {}) {
  const command = `pnpm db:verify-legacy${manifestArg === null ? "" : ` --manifest ${manifestArg}`}`;
  const windows = process.platform === "win32";
  const env = { ...process.env, ...extraEnv, DATABASE_URL: url };
  try {
    const result = await execFile(windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
      windows ? ["/d", "/s", "/c", command] : ["db:verify-legacy", ...(manifestArg === null ? [] : ["--manifest", manifestArg])],
      { cwd: repoRoot, env });
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
async function databaseState(url: string) {
  const tables = (await query(url, `
    SELECT c.relname AS name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `)).rows as { name: string }[];
  const relations = (await query(url, `
    SELECT c.relname AS name, c.relkind AS kind
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, c.relkind
  `)).rows;
  const sequences = (await query(url, `
    SELECT * FROM pg_catalog.pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename
  `)).rows;
  return {
    relations,
    tables: await Promise.all(tables.map(async ({ name }) => ({
      name,
      rows: (await query(url, `
        SELECT to_jsonb(t) AS row
        FROM public.${quoteIdentifier(name)} AS t
        ORDER BY to_jsonb(t)::text
      `)).rows.map(({ row }) => row),
    }))),
    sequences,
  };
}
async function expectFailureUnchanged(url: string, change: (url: string) => Promise<unknown>, text = "schema fingerprint drift") {
  await change(url); const before = await databaseState(url); const result = await invoke(url);
  expect(result.code).not.toBe(0); expect(result.output).toContain(text);
  expect(await databaseState(url)).toEqual(before);
  expect((await query(url, "SELECT to_regclass('__sechub_migrations') AS name")).rows[0].name).toBeNull();
}
async function insertUser(url: string, role: string) {
  const id = `00000000-0000-7000-8000-${String(databases.length).padStart(12, "0")}`;
  await query(url, "INSERT INTO usuarios (id, email, password_hash, role, estudio_id) SELECT $1, $2, 'x', $3, id FROM estudios LIMIT 1", [id, `${role}@legacy.test`, role]);
  return id;
}
async function withManifest(edit: (source: string) => string, expected: string) {
  const source = readFileSync(manifestPath, "utf8");
  try { writeFileSync(manifestPath, edit(source)); const result = await invoke("postgresql://redacted:password@invalid.invalid/db"); expect(result.code).toBe(1); expect(result.output).toContain(expected); expect(result.output).not.toContain("redacted"); }
  finally { writeFileSync(manifestPath, source); }
}
async function withMigration(edit: (source: string) => string, expected: string) {
  const path = join(migrationDir, migrations[0]); const source = readFileSync(path, "utf8");
  try { writeFileSync(path, edit(source)); const result = await invoke("postgresql://redacted:password@invalid.invalid/db"); expect(result.code).toBe(1); expect(result.output).toContain(expected); expect(result.output).not.toContain("redacted"); }
  finally { writeFileSync(path, source); }
}

afterEach(async () => {
  const admin = localAdminUrl(); if (!admin) return;
  for (const name of databases.splice(0)) {
    await query(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
    await query(admin, `DROP DATABASE "${name}"`);
  }
});

describe("pnpm db:verify-legacy", () => {
  it.each([
    ["usage", null, "usage:"], ["outside manifest", "missing.json", "checked-in legacy-public-v1.json"],
  ])("rejects $0 before connecting", async (_, arg, text) => {
    const result = await invoke("postgresql://redacted:password@invalid.invalid/db", arg);
    expect(result.code).toBe(1); expect(result.output).toContain(text); expect(result.output).not.toContain("redacted");
  });
  it("reports a missing DATABASE_URL", async () => {
    const result = await invoke("", manifest, { DATABASE_URL: "" });
    expect(result.code).toBe(1); expect(result.output).toContain("DATABASE_URL is required");
  });
  it("reports connection errors without operational values", async () => {
    const result = await invoke("postgresql://user_leak_marker:pw_leak_marker@invalid.invalid/db");
    expect(result.code).toBe(1); expect(result.output).toContain("database connection failed");
    expect(result.output).not.toContain("user_leak_marker"); expect(result.output).not.toContain("pw_leak_marker");
  });
  it("reports malformed manifests", async () => withManifest(() => "{", "manifest is malformed JSON"));
  it.each([
    ["fingerprint", (s: string) => s.replace(/("fingerprint": ")[a-f0-9]{64}/, `$1${"0".repeat(64)}`)],
    ["catalog", (s: string) => s.replace('"admin", "lectura"', '"tampered", "lectura"')],
  ])("rejects changed manifest $0 before connecting", async (_, edit) => withManifest(edit, "manifest integrity drift"));
  it("reports non-canonical migration filenames", async () => withManifest((s) => s.replace(/("filename": ")[^"]+/, "$1changed.sql"), "canonical"));
  it("reports shipped migration hash drift", async () => withMigration((s) => `${s}\n-- source migration drift`, "migration hash drift"));

  it("rejects an empty/fresh database", async () => {
    const url = await database(false); const result = await invoke(url);
    expect(result.code).not.toBe(0); expect(result.output).toContain("empty or fresh");
  });
  it("accepts the exact legacy state without changing rows or metadata", async () => {
    const url = await database(); const before = await databaseState(url); const result = await invoke(url);
    expect(result.code).toBe(0); expect(result.output).toContain("verified"); expect(await databaseState(url)).toEqual(before);
    expect((await query(url, "SELECT to_regclass('__sechub_migrations') AS name")).rows[0].name).toBeNull();
  });
  it("rejects metadata presence", async () => {
    const url = await database(); await query(url, "CREATE TABLE __sechub_migrations (id integer)");
    const result = await invoke(url); expect(result.code).not.toBe(0); expect(result.output).toContain("metadata is present");
  });
  it.each([
    ["extra table", "CREATE TABLE legacy_drift (id integer PRIMARY KEY)"], ["missing table", "DROP TABLE sessions"],
    ["extra column", "ALTER TABLE usuarios ADD COLUMN legacy_drift text"], ["missing column", "ALTER TABLE usuarios DROP COLUMN role"],
    ["extra constraint", "ALTER TABLE usuarios ADD CONSTRAINT legacy_drift CHECK (id IS NOT NULL)"], ["missing constraint", "ALTER TABLE usuarios DROP CONSTRAINT usuarios_email_unique"],
    ["extra index", "CREATE INDEX legacy_drift ON usuarios (email)"], ["missing index", "DROP INDEX actas_expediente_idx"],
    ["extra sequence", "CREATE SEQUENCE legacy_drift"], ["missing sequence", "DROP SEQUENCE roles_id_seq CASCADE"],
    ["extra view", "CREATE VIEW legacy_drift AS SELECT 1"],
  ])("rejects $0 drift", async (_, ddl) => expectFailureUnchanged(await database(), (url) => query(url, ddl)));
  it.each([
    ["catalog", async (url: string) => query(url, "UPDATE roles SET codigo = 'unexpected' WHERE codigo = 'admin'"), "catalog drift: roles"],
    ["missing mapping", async (url: string) => insertUser(url, "admin"), "relationship drift"],
    ["mismatched mapping", async (url: string) => { const id = await insertUser(url, "admin"); return query(url, "INSERT INTO usuarios_roles (usuario_id, rol_id) SELECT $1, id FROM roles WHERE codigo = 'lectura'", [id]); }, "relationship drift"],
    ["unknown scalar role", async (url: string) => insertUser(url, "not-a-role"), "relationship drift"],
  ])("rejects $0", async (_, change, text) => expectFailureUnchanged(await database(), change, text));
});
