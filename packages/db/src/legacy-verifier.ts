import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationSha256 } from "./migration-utils.js";
import type { Client } from "pg";

const METADATA_TABLE = "__sechub_migrations";
const MANIFEST_NAME = "legacy-public-v1.json";
const EXPECTED_MANIFEST_DIGEST = "1164e72deb5d8602c45fe0493f77a46934a76fb2b225c7d938a4bfdc2546976d";
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = join(MODULE_DIR, "migrations", "manifests");
const MIGRATIONS_DIR = join(MANIFEST_DIR, "..");

export type LegacyQueryClient = {
  query(text: string): Promise<{ rows: any[] }>;
};

type Manifest = {
  name: string;
  schema: { name: string; version: string };
  migrations: Array<{ filename: string; sha256: string }>;
  fingerprint: string;
  catalogs: Record<string, string[]>;
  relationship: { scalarColumn: string; relation: string; roleColumn: string };
};

export class LegacyVerificationError extends Error {}
function fail(message: string): never { throw new LegacyVerificationError(message); }
function normalizedSql(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("manifest is not canonical JSON");
  return encoded;
}
function loadManifest(path: string): Manifest {
  const requested = resolve(path); const shipped = resolve(MANIFEST_DIR, MANIFEST_NAME);
  if (requested !== shipped || !existsSync(requested)) fail("manifest must be the checked-in legacy-public-v1.json");
  let value: unknown;
  try { value = JSON.parse(readFileSync(requested, "utf8")); } catch { fail("manifest is malformed JSON"); }
  const manifest = value as Partial<Manifest>;
  if (manifest.name !== "legacy-public-v1" || manifest.schema?.name !== "public" || manifest.schema.version !== "0006") fail("manifest has an unsupported schema identity");
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length !== 7 || manifest.migrations.some((m) => !m || typeof m.filename !== "string" || !/^[a-f0-9]{64}$/.test(m.sha256))) fail("manifest has an invalid migration list");
  if (typeof manifest.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(manifest.fingerprint) || !manifest.catalogs || typeof manifest.catalogs !== "object" || !manifest.relationship || manifest.relationship.scalarColumn !== "role" || manifest.relationship.relation !== "usuarios_roles" || manifest.relationship.roleColumn !== "rol_id") fail("manifest has invalid verification rules");
  const names = manifest.migrations.map((m) => m.filename);
  const expected = ["0000_aberrant_dakota_north.sql", "0001_thankful_meggan.sql", "0002_wild_doctor_faustus.sql", "0003_wealthy_iron_monger.sql", "0004_brief_mesmero.sql", "0005_role_sector_permissions.sql", "0006_actas_orphan_tray.sql"];
  if (names.some((name, index) => name !== expected[index])) fail("manifest migration filenames are not canonical");
  const catalogNames = ["roles", "sectores", "estados_caso", "tipos_audiencia", "tipos_acta", "estados_acta"];
  if (Object.keys(manifest.catalogs).sort().join() !== catalogNames.sort().join() || Object.values(manifest.catalogs).some((codes) => !Array.isArray(codes) || codes.some((code) => typeof code !== "string"))) fail("manifest catalog codes are malformed");
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  if (digest !== EXPECTED_MANIFEST_DIGEST) fail("manifest integrity drift");
  return manifest as Manifest;
}
function migrationHashes(manifest: Manifest): void {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  if (files.slice(0, manifest.migrations.length).join() !== manifest.migrations.map((migration) => migration.filename).join()) fail("migration filenames drift");
  for (const migration of manifest.migrations) {
    const path = join(MIGRATIONS_DIR, migration.filename);
    if (!existsSync(path)) fail(`shipped migration is missing: ${migration.filename}`);
    const actual = migrationSha256(readFileSync(path, "utf8"));
    if (actual !== migration.sha256) fail(`migration hash drift: ${migration.filename}`);
  }
}
async function fingerprint(client: LegacyQueryClient): Promise<string> {
  const relationRows = (await client.query(`SELECT c.oid::text AS oid, c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S') AND c.relname <> '${METADATA_TABLE}' ORDER BY c.relname, c.relkind`)).rows;
  const relations = relationRows.map(({ oid: _oid, ...relation }) => relation); const scope = relationRows.map((row) => row.oid).join(",") || "0";
  const columns = (await client.query(`SELECT c.relname AS relation, a.attnum::int AS ordinal, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, (NOT a.attnotnull) AS nullable, COALESCE(pg_get_expr(d.adbin, d.adrelid, true), '') AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid IN (${scope}) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum`)).rows.map((row) => ({ ...row, default_value: normalizedSql(row.default_value) }));
  const constraints = (await client.query(`SELECT c.relname AS relation, con.conname AS name, con.contype AS kind, pg_get_constraintdef(con.oid, true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid WHERE con.conrelid IN (${scope}) ORDER BY c.relname, con.conname`)).rows.map((row) => ({ ...row, definition: normalizedSql(row.definition) }));
  const indexes = (await client.query(`SELECT t.relname AS relation, i.relname AS name, pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname <> '${METADATA_TABLE}' ORDER BY t.relname, i.relname`)).rows.map((row) => ({ ...row, definition: normalizedSql(row.definition) }));
  const sequences = (await client.query(`SELECT c.relname AS name, s.seqtypid::regtype::text AS type, s.seqstart::text AS start, s.seqmin::text AS minimum, s.seqmax::text AS maximum, s.seqincrement::text AS increment, s.seqcycle AS cycle, s.seqcache::text AS cache, COALESCE(owner_table.relname || '.' || owner_column.attname, '') AS owned_by FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a' LEFT JOIN pg_class owner_table ON owner_table.oid = d.refobjid LEFT JOIN pg_attribute owner_column ON owner_column.attrelid = d.refobjid AND owner_column.attnum = d.refobjsubid WHERE n.nspname = 'public' AND c.relname <> '${METADATA_TABLE}' ORDER BY c.relname`)).rows;
  const views = (await client.query(`SELECT c.relname AS name, c.relkind AS kind, pg_get_viewdef(c.oid, true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v','m') ORDER BY c.relname`)).rows.map((row) => ({ ...row, definition: normalizedSql(row.definition) }));
  return createHash("sha256").update(JSON.stringify({ relations, columns, constraints, indexes, sequences, views })).digest("hex");
}
async function verifyCatalogs(client: LegacyQueryClient, manifest: Manifest): Promise<void> {
  for (const [table, expected] of Object.entries(manifest.catalogs)) {
    const actual = (await client.query(`SELECT codigo FROM public."${table}" ORDER BY codigo`)).rows.map((row) => row.codigo);
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) fail(`catalog drift: ${table}`);
  }
}
export function validateLegacyManifest(manifestPath: string): void { migrationHashes(loadManifest(manifestPath)); }
export async function verifyLegacyState(client: LegacyQueryClient, manifestPath: string): Promise<void> {
  const manifest = loadManifest(manifestPath); migrationHashes(manifest);
  const metadata = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '${METADATA_TABLE}') AS present`);
  if (metadata.rows[0].present) fail("migration metadata is present; use normal migration verification");
  const objects = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S') AND c.relname <> '${METADATA_TABLE}' LIMIT 1`);
  if (objects.rows.length === 0) fail("database is empty or fresh; legacy schema is required");
  if (await fingerprint(client) !== manifest.fingerprint) fail("public schema fingerprint drift");
  await verifyCatalogs(client, manifest);
  const { scalarColumn, relation, roleColumn } = manifest.relationship;
  const relationship = await client.query(`SELECT 1 FROM public.usuarios u LEFT JOIN public.roles r ON r.codigo = u."${scalarColumn}" WHERE r.id IS NULL OR NOT EXISTS (SELECT 1 FROM public."${relation}" ur WHERE ur.usuario_id = u.id AND ur."${roleColumn}" = r.id) OR EXISTS (SELECT 1 FROM public."${relation}" ur WHERE ur.usuario_id = u.id AND (r.id IS NULL OR ur."${roleColumn}" <> r.id)) LIMIT 1`);
  if (relationship.rows.length !== 0) fail("usuarios_roles relationship drift: scalar roles must resolve to exactly their mapping");
}

export async function verifyLegacy(client: Client, manifestPath: string): Promise<void> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try { await verifyLegacyState(client, manifestPath); await client.query("ROLLBACK"); }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
}
