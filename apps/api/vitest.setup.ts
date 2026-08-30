import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envDir = join(__dirname, "..", "..");
const explicitDatabaseUrl = process.env.DATABASE_URL;

config({ path: join(envDir, ".env") });
config({ path: join(envDir, ".env.local"), override: true });

if (explicitDatabaseUrl !== undefined) process.env.DATABASE_URL = explicitDatabaseUrl;
