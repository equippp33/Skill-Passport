/**
 * Create (or update the password of) an interview candidate.
 *
 * There is deliberately no self-service registration in this app — the brief
 * kept authentication to email + password only — so accounts are provisioned
 * with this script.
 *
 *   node scripts/create-user.mjs candidate@example.com "correct horse battery"
 *
 * Written in plain ESM rather than TypeScript so it runs with bare `node`
 * without a loader or path-alias resolution.
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const scrypt = promisify(scryptCb);

// Keep in sync with src/server/auth/password.ts
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
loadEnv({ path: "../../.env" });

const [, , emailArg, passwordArg, nameArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error(
    "Usage: node scripts/create-user.mjs <email> <password> [name]",
  );
  process.exit(1);
}
if (passwordArg.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const passwordHash = await hashPassword(passwordArg);

  const [row] = await sql`
    insert into users (email, password_hash, name)
    values (${email}, ${passwordHash}, ${nameArg ?? null})
    on conflict (email) do update
      set password_hash = excluded.password_hash,
          name = coalesce(excluded.name, users.name),
          updated_at = now()
    returning id, email
  `;

  console.log(`✓ user ready: ${row.email} (${row.id})`);
} catch (error) {
  console.error(`✗ failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
