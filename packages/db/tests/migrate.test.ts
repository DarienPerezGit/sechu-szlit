import { afterEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations, schema } from "../src/index.js";
import { assertNoAddressOverrides } from "../../../tests/helpers/test-database.js";

const execFile = promisify(execFileCallback);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const explicitDatabaseUrl = process.env.DATABASE_URL;
config({ path: join(repoRoot, ".env.local"), override: true });
if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;
const adminUrl = process.env.TEST_DATABASE_URL;
const migrationDir = join(repoRoot, "packages", "db", "src", "migrations");
const migrationFiles = readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort();
const legacyMigrationFiles = migrationFiles.slice(0, 7);
const databases: string[] = [];
const expectedPostgresMajor = process.env.EXPECTED_POSTGRES_MAJOR;
const PG18_SERVER_VERSION_NUM = 180000;

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

function withSearchPath(url: string): string {
  const scoped = new URL(url);
  scoped.searchParams.set("options", "-c search_path=shadow,public");
  return scoped.toString();
}

async function invokeMigration(url: string, testDatabaseUrl?: string, args: string[] = []) {
  try {
    const windows = process.platform === "win32";
    const env = { ...process.env, DATABASE_URL: url };
    if (testDatabaseUrl) env.TEST_DATABASE_URL = testDatabaseUrl;
    else delete env.TEST_DATABASE_URL;
    const result = await execFile(
      windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
      windows ? ["/d", "/s", "/c", `pnpm db:migrate${args.length ? ` -- ${args.join(" ")}` : ""}`] : ["db:migrate", ...(args.length ? ["--", ...args] : [])],
      { cwd: repoRoot, env },
    );
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return { status: result.code ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
}

async function applyLegacySchema(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const filename of legacyMigrationFiles) {
      const contents = readFileSync(join(migrationDir, filename), "utf8");
      for (const statement of contents.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
    }
  } finally {
    await client.end();
  }
}

async function applyMigration(url: string, filename: string): Promise<void> {
  await query(url, readFileSync(join(migrationDir, filename), "utf8"));
}

afterEach(async () => {
  for (const name of databases.splice(0)) {
    await query(requireAdminUrl(),
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [name]);
    await query(requireAdminUrl(), `DROP DATABASE "${name}"`);
  }
});

describe("test database URL guard", () => {
  it.each(["host", "HOST", "hostaddr", "HOSTADDR", "port", "PORT"])("rejects %s overrides", (key) => {
    expect(() => assertNoAddressOverrides(new URL(`postgresql://localhost/db?${key}=remote`))).toThrow("address");
  });
  it("allows valid query settings", () => expect(() => assertNoAddressOverrides(new URL("postgresql://localhost/db?sslmode=require"))).not.toThrow());
});

describe("runMigrations UUIDv7 compatibility", () => {
  it("uses the UUIDv7 compatibility fallback on PostgreSQL before 18", async ({ skip }) => {
    const url = await createDatabase();
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    try {
      const capability = await query(url, `SELECT current_setting('server_version_num')::int AS version`);
      const version = capability.rows[0].version as number;
      if (expectedPostgresMajor !== undefined) {
        expect(Math.floor(version / 10000).toString()).toBe(expectedPostgresMajor);
      }
      if (version >= PG18_SERVER_VERSION_NUM) {
        skip("PostgreSQL 18 native UUIDv7 is covered by the preservation test");
        return;
      }
      expect((await query(url, `SELECT to_regprocedure('pg_catalog.uuidv7()') AS oid`)).rows[0].oid).toBeNull();
      await query(url, `
        CREATE FUNCTION public.uuidv7() RETURNS uuid
        LANGUAGE sql IMMUTABLE
        AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$
      `);
      await runMigrations(db);
      const generated = await query(url, `
        SELECT public.uuidv7()::text AS id,
               to_regprocedure('uuidv7()')::oid AS resolved_oid,
               to_regprocedure('public.uuidv7()')::oid AS public_oid
      `);
      const row = generated.rows[0] as {
        id: string;
        resolved_oid: number;
        public_oid: number;
      };
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(row.resolved_oid).toEqual(expect.any(Number));
      expect(row.public_oid).toEqual(expect.any(Number));
      expect(row.public_oid).toEqual(row.resolved_oid);
      const configuration = (await query(url, `SELECT proconfig, prosecdef FROM pg_proc WHERE oid = 'public.uuidv7()'::regprocedure`)).rows[0];
      expect(configuration.proconfig).toContain("search_path=pg_catalog");
      expect(configuration.prosecdef).toBe(false);

      const observedBefore = Date.now();
      const batch = await query(url, `
        SELECT array_agg(public.uuidv7()::text ORDER BY ordinal) AS ids
        FROM generate_series(1, 64) AS calls(ordinal)
      `);
      const observedAfter = Date.now();
      const ids = batch.rows[0].ids as string[];
      expect(ids).toHaveLength(64);
      expect(new Set(ids).size).toBe(64);
      expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
      const timestamps = ids.map((id) => Number.parseInt(`${id.slice(0, 8)}${id.slice(9, 13)}`, 16));
      expect(timestamps.every((timestamp, index) => index === 0 || timestamp >= timestamps[index - 1])).toBe(true);
      expect(timestamps.every((timestamp) => timestamp >= observedBefore - 10_000 && timestamp <= observedAfter + 10_000)).toBe(true);

      expect(await runMigrations(db)).toEqual({ applied: 0 });
      const rerun = await query(url, `SELECT to_regprocedure('uuidv7()')::oid AS resolved_oid, to_regprocedure('public.uuidv7()')::oid AS public_oid`);
      expect(rerun.rows[0]).toEqual({ resolved_oid: row.resolved_oid, public_oid: row.public_oid });
    } finally {
      await pool.end();
    }
  });

  it("preserves the native zero-argument uuidv7 on PostgreSQL 18", async ({ skip }) => {
    const url = await createDatabase();
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    try {
      const before = await query(url, `SELECT current_setting('server_version_num')::int AS version, to_regprocedure('pg_catalog.uuidv7()')::oid AS native_oid`);
      if (expectedPostgresMajor !== undefined) {
        expect(Math.floor(before.rows[0].version / 10000).toString()).toBe(expectedPostgresMajor);
      }
      if (before.rows[0].version < PG18_SERVER_VERSION_NUM) {
        skip("PostgreSQL before 18 uses the compatibility fallback test");
        return;
      }
      expect(before.rows[0].native_oid).toEqual(expect.any(Number));

      await runMigrations(db);
      const after = await query(url, `SELECT to_regprocedure('uuidv7()')::oid AS resolved_oid, to_regprocedure('public.uuidv7()')::oid AS public_oid`);
      expect(after.rows[0]).toEqual({ resolved_oid: before.rows[0].native_oid, public_oid: null });
    } finally {
      await pool.end();
    }
  });
});

describe("pnpm db:migrate", () => {
  it("uses DATABASE_URL when both migration variables are present", async () => {
    const databaseUrl = await createDatabase();
    const testDatabaseUrl = await createDatabase();
    const result = await invokeMigration(databaseUrl, testDatabaseUrl);

    expect(result.status).toBe(0);
    expect((await query(databaseUrl, `SELECT count(*)::int AS count FROM "__sechub_migrations"`)).rows[0].count)
      .toBe(8);
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
      "0007_drop_usuarios_role.sql",
    ]);
    expect((await query(url, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'role'`)).rows).toEqual([]);
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
    expect(`${result.stdout}${result.stderr}`).toContain("pnpm db:migrate -- --adopt-existing");
    const metadata = await query(url, `SELECT to_regclass('__sechub_migrations') AS name`);
    expect(metadata.rows[0].name).toBeNull();
  });

  it("rejects explicit adoption with a non-canonical migration directory", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    try {
      await expect(
        runMigrations(db, join(migrationDir, "meta"), { adoptExisting: true }),
      ).rejects.toThrow("canonical shipped migration directory");
    } finally {
      await pool.end();
    }
  });

  it("adopts the legacy prefix, applies 0007, and preserves normalized role data", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    const userId = "00000000-0000-7000-8000-000000000025";
    await query(url, `
      INSERT INTO usuarios (id, email, password_hash, role, estudio_id)
      SELECT $1, 'legacy-adoption@test.com', 'x', 'admin', id FROM estudios LIMIT 1
    `, [userId]);
    await query(url, `
      INSERT INTO usuarios_roles (usuario_id, rol_id)
      SELECT $1, id FROM roles WHERE codigo = 'admin'
    `, [userId]);

    const result = await invokeMigration(url, undefined, ["--adopt-existing"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Adopted 7 migration(s).");
    expect(result.stdout).toContain("Applied 1 migration(s).");
    expect((await query(url, `SELECT count(*)::int AS count FROM "__sechub_migrations"`)).rows[0].count)
      .toBe(8);
    expect((await query(url, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'role'`)).rows).toEqual([]);
    expect((await query(url, `
      SELECT ur.usuario_id, r.codigo
      FROM usuarios_roles ur INNER JOIN roles r ON r.id = ur.rol_id
      WHERE ur.usuario_id = $1
    `, [userId])).rows).toEqual([{ usuario_id: userId, codigo: "admin" }]);
  });

  it("fails clearly and preserves the scalar column when a role code is unknown", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    await query(url, `
      INSERT INTO usuarios (email, password_hash, role, estudio_id)
      SELECT 'unknown-role@test.com', 'x', 'unknown-role', id FROM estudios LIMIT 1
    `);

    await expect(applyMigration(url, "0007_drop_usuarios_role.sql"))
      .rejects.toThrow("unknown role code");
    expect((await query(url, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'role'`)).rows).toHaveLength(1);
  });

  it("pins legacy adoption metadata to public with a non-default search path", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    await query(url, "CREATE SCHEMA shadow");
    const before = await query(url, `SELECT count(*)::int AS count FROM public.estudios`);

    const result = await invokeMigration(withSearchPath(url), undefined, ["--adopt-existing"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Adopted 7 migration(s).");
    expect(result.stdout).toContain("Applied 1 migration(s).");
    expect((await query(url, `SELECT count(*)::int AS count FROM public."__sechub_migrations"`)).rows[0].count).toBe(8);
    expect(await query(url, `SELECT count(*)::int AS count FROM public.estudios`)).toEqual(before);
    expect((await query(url, `SELECT to_regclass('shadow.__sechub_migrations') AS name`)).rows[0].name).toBeNull();
  });

  it("is an exact no-op after legacy adoption", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    expect((await invokeMigration(url, undefined, ["--adopt-existing"])).status).toBe(0);
    const records = await query(url,
      `SELECT filename, sha256 FROM "__sechub_migrations" ORDER BY id`);

    const result = await invokeMigration(url);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("up to date");
    expect((await query(url,
      `SELECT filename, sha256 FROM "__sechub_migrations" ORDER BY id`)).rows)
      .toEqual(records.rows);
  });

  it("leaves metadata unapplied when legacy verification fails", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    await query(url, `ALTER TABLE usuarios ADD COLUMN legacy_adoption_drift text`);

    const result = await invokeMigration(url, undefined, ["--adopt-existing"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("schema fingerprint drift");
    expect((await query(url, `SELECT to_regclass('__sechub_migrations') AS name`)).rows[0].name)
      .toBeNull();
  });

  it("serializes concurrent fresh invocations", async () => {
    const url = await createDatabase();
    const results = await Promise.all([invokeMigration(url), invokeMigration(url)]);
    expect(results.map((result) => result.status)).toEqual([0, 0]);
    expect(results.filter((result) => result.stdout.includes("Applied 8 migration(s)")).length).toBe(1);
    expect(results.filter((result) => result.stdout.includes("up to date")).length).toBe(1);
    const records = await query(url, `SELECT count(*)::int AS count FROM "__sechub_migrations"`);
    expect(records.rows[0].count).toBe(8);
  });

  it("serializes concurrent explicit adoption without replaying SQL", async () => {
    const url = await createDatabase();
    await applyLegacySchema(url);
    const before = await query(url, `
      SELECT (SELECT count(*) FROM estudios) AS estudios,
             (SELECT count(*) FROM sectores) AS sectores,
             (SELECT count(*) FROM estados_caso) AS estados,
             (SELECT count(*) FROM tipos_audiencia) AS audiencias
    `);

    const results = await Promise.all([
      invokeMigration(url, undefined, ["--adopt-existing"]),
      invokeMigration(url, undefined, ["--adopt-existing"]),
    ]);

    expect(results.map((result) => result.status)).toEqual([0, 0]);
    expect(results.filter((result) => result.stdout.includes("Adopted 7 migration(s)")).length).toBe(1);
    expect(results.filter((result) => result.stdout.includes("Applied 1 migration(s)")).length).toBe(1);
    expect(results.filter((result) => result.stdout.includes("up to date")).length).toBe(1);
    expect(await query(url, `
      SELECT (SELECT count(*) FROM estudios) AS estudios,
             (SELECT count(*) FROM sectores) AS sectores,
             (SELECT count(*) FROM estados_caso) AS estados,
             (SELECT count(*) FROM tipos_audiencia) AS audiencias
    `)).toEqual(before);
    expect((await query(url, `
      SELECT filename, count(*)::int AS count
      FROM "__sechub_migrations"
      GROUP BY filename
      HAVING count(*) <> 1
    `)).rows).toEqual([]);
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
    expect(records.rows[0].count).toBe(7);
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
