import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so it does not pick up .env.local on its own.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
// Monorepo root .env is the shared source for local secrets.
loadEnv({ path: "../../.env" });

/**
 * `generate` only reads the schema, so it must work without a database (CI,
 * fresh clone). Commands that actually connect — migrate/push/studio — fail
 * loudly against this placeholder instead of silently using a wrong database.
 */
const url =
  process.env.DATABASE_URL ?? "postgresql://unset:unset@127.0.0.1:1/unset";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
