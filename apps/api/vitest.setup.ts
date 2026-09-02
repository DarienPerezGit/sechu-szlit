import { afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setupDisposableTestDatabase } from "../../tests/helpers/test-database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envDir = join(__dirname, "..", "..");
const explicitDatabaseUrl = process.env.DATABASE_URL;
const explicitTestDatabaseUrl = process.env.TEST_DATABASE_URL;

config({ path: join(envDir, ".env") });
config({ path: join(envDir, ".env.local"), override: true });

if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;
if (explicitTestDatabaseUrl !== undefined) process.env.TEST_DATABASE_URL = explicitTestDatabaseUrl;

const cleanup = await setupDisposableTestDatabase();
if (cleanup) afterAll(cleanup);
