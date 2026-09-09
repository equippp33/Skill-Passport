/**
 * Test environment bootstrap.
 *
 * Tests deliberately do NOT set SKIP_ENV_VALIDATION. When t3-env skips
 * validation it returns `process.env` untouched, which means every zod
 * `.default()` is dropped — so a skipped-validation run would exercise a
 * different env contract than production and hide bugs such as a missing
 * CLOUDFLARE_R2_BUCKET default.
 *
 * Instead we fill placeholders for anything the root .env does not provide,
 * so validation passes and defaults apply exactly as they do at runtime.
 */

// Force real validation even on CI, where `~/env` would otherwise skip it and
// silently drop every zod default.
delete process.env.SKIP_ENV_VALIDATION;
delete process.env.CI;
delete process.env.NEXT_BUILD;

/**
 * `??=` is not enough: the root .env may declare a key with an empty value
 * (`OPENAI_API_KEY=`), and `env.ts` uses `emptyStringAsUndefined`. Treat empty
 * exactly as missing.
 */
function fallback(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

/** Whether a real database was configured before placeholders were applied. */
export const HAS_REAL_DB = Boolean(process.env.DATABASE_URL);

/** Whether real R2 credentials were configured. */
export const HAS_REAL_R2 = Boolean(
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
  process.env.CLOUDFLARE_R2_ENDPOINT,
);

process.env.__SKILL_PASSPORT_HAS_DB = HAS_REAL_DB ? "1" : "";
process.env.__SKILL_PASSPORT_HAS_R2 = HAS_REAL_R2 ? "1" : "";

// Unreachable placeholders: a test that actually needs one of these must get
// the real value from the root .env.
fallback("UI_LANGUAGE", "english");
fallback("INTERVIEW_LANGUAGE", "marathi");
fallback("DATABASE_URL", "postgresql://unset:unset@127.0.0.1:1/unset");
fallback("OPENAI_API_KEY", "test-openai-key");
fallback("SARVAM_API_KEY", "test-sarvam-key");
fallback("CLOUDFLARE_R2_ACCESS_KEY_ID", "test-access-key");
fallback("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "test-secret-key");
fallback("CLOUDFLARE_R2_ENDPOINT", "https://r2.invalid");
