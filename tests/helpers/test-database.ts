import { Client } from "pg";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
let databaseSequence = 0;

export function assertNoAddressOverrides(url: URL): void {
  if ([...url.searchParams.keys()].some((key) => /^(host(addr)?|port)$/i.test(key))) throw new Error("TEST_DATABASE_URL query must not override the local address");
}

function localAdminUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL is required; refusing to use DATABASE_URL for disposable tests");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a local PostgreSQL URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.includes(hostname) || (url.port && url.port !== "5432")) {
    throw new Error("TEST_DATABASE_URL must point to a local PostgreSQL server");
  }
  assertNoAddressOverrides(url);
  return raw;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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

function databaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function setupDisposableTestDatabase(): Promise<() => Promise<void>> {
  const adminUrl = localAdminUrl();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const name = `sechub_test_${process.pid}_${Date.now()}_${databaseSequence++}`;
  await query(adminUrl, `CREATE DATABASE ${quoteIdentifier(name)}`);
  process.env.DATABASE_URL = databaseUrl(adminUrl, name);

  return async () => {
    const errors: unknown[] = [];
    try {
      await query(adminUrl, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
    } catch (error) {
      errors.push(error);
    }
    try {
      await query(adminUrl, `DROP DATABASE ${quoteIdentifier(name)}`);
    } catch (error) {
      errors.push(error);
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `failed to clean up disposable database ${name}`);
  };
}
