/**
 * Seed the admin account.
 *
 *   pnpm --filter @skill-passport/nextjs seed:admin
 *
 * Credentials come from the environment so a deployment never has to ship the
 * defaults:
 *
 *   SEED_ADMIN_EMAIL     (default admin@skillpassport.com)
 *   SEED_ADMIN_PASSWORD  (default admin@123 — TEMPORARY, change it)
 *   SEED_ADMIN_NAME      (optional)
 *
 * The password is hashed with the same scrypt scheme the app uses at login
 * (src/server/auth/password.ts); plaintext is never written. Re-running is
 * safe: it updates the existing row rather than creating a second admin.
 *
 * The seeded account is flagged `must_change_password`, which shows a banner
 * in the admin UI until the password is rotated.
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

const DEFAULT_PASSWORD = "admin@123";

const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@skillpassport.com")
  .trim()
  .toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_PASSWORD;
const name = process.env.SEED_ADMIN_NAME ?? "Administrator";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

// Refuse to plant a known password in production.
const usingDefault = password === DEFAULT_PASSWORD;
if (usingDefault && process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to seed the default password with NODE_ENV=production.\n" +
      "Set SEED_ADMIN_PASSWORD to something private first.",
  );
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const passwordHash = await hashPassword(password);

  const [row] = await sql`
    insert into users (email, password_hash, name, role, must_change_password)
    values (${email}, ${passwordHash}, ${name}, 'admin', ${usingDefault})
    on conflict (email) do update
      set password_hash = excluded.password_hash,
          name = coalesce(excluded.name, users.name),
          role = 'admin',
          must_change_password = excluded.must_change_password,
          updated_at = now()
    returning id, email
  `;

  console.log(`✓ admin ready: ${row.email} (${row.id})`);
  if (usingDefault) {
    console.log(
      "\n  ⚠  This is the default temporary password. Change it before\n" +
        "     production by re-running with SEED_ADMIN_PASSWORD set.",
    );
  }
  console.log("\n  Sign in at /login, then use the admin dashboard at /admin.");
} catch (error) {
  console.error(`✗ failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
