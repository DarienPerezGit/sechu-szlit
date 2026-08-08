import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  // Point at the compiled JS (not the TS source): drizzle-kit's CommonJS
  // loader cannot resolve the `.js` ESM re-export extensions used in
  // schema/index.ts when reading native TS, so it must read the built
  // output. Run `pnpm --filter @sechub/db build` before `generate`.
  schema: "./dist/schema/index.js",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
