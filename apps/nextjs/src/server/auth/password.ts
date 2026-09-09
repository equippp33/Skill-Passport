import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// `promisify` resolves to scrypt's 3-argument overload, which drops the
// options bag. Pin the 4-argument signature explicitly.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing via Node's built-in scrypt.
 *
 * Deliberately dependency-free: argon2 bindings (`@node-rs/argon2`) are a
 * native module and are a common source of install/deploy breakage across
 * Windows dev machines and Linux CI. scrypt is memory-hard, in Node core, and
 * is an accepted choice for password storage.
 *
 * Format: `scrypt$N$r$p$<salt-hex>$<key-hex>`, so parameters can be raised
 * later without invalidating existing hashes.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "hex");
  const expected = Buffer.from(parts[5] ?? "", "hex");
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    expected.length,
    { N: n, r, p },
  );

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
