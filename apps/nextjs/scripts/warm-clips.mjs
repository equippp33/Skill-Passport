/**
 * Warm the fixed per-language TTS clips into R2, once, ahead of time.
 *
 * The filler and check-in clips are identical across every interview, so they
 * only ever need to be generated once — but if they are generated lazily on the
 * first interview per language, that interview fires ~4 TTS calls at once and
 * can trip Sarvam's rate limit (bulbul:v3 is only 30 req/min on Starter). This
 * mints them all ahead of time, PACED under that limit, by hitting the app's
 * own routes (which generate-and-cache in R2). After this runs, interviews
 * never spend TTS budget on these clips again.
 *
 * Run it AGAINST A DEPLOYED APP (it uses that app's Sarvam key + R2), when no
 * interviews are active so the warm-up isn't competing for the rate limit:
 *
 *   WARMUP_BASE_URL=https://devskillpassport.threepointolabs.com \
 *     node scripts/warm-clips.mjs
 *   # or specific languages only:
 *   WARMUP_BASE_URL=http://localhost:3000 node scripts/warm-clips.mjs english marathi
 */

const BASE = process.env.WARMUP_BASE_URL?.replace(/\/+$/, "");
if (!BASE) {
  console.error(
    "WARMUP_BASE_URL required, e.g. https://devskillpassport.threepointolabs.com",
  );
  process.exit(1);
}

// Mirrors INTERVIEW_LANGUAGE_KEYS in ~/config/languages. A one-off ops script,
// so the list is inlined rather than importing the TS config.
const ALL_LANGS = [
  "english",
  "hindi",
  "marathi",
  "bengali",
  "gujarati",
  "kannada",
  "malayalam",
  "odia",
  "punjabi",
  "tamil",
  "telugu",
];
const FILLER_VARIANTS = 3;
// ~24 req/min — comfortably under the 30/min bulbul:v3 Starter cap.
const PACE_MS = 2500;

const langs = process.argv.slice(2).length ? process.argv.slice(2) : ALL_LANGS;

const urls = [];
for (const lang of langs) {
  for (let v = 0; v < FILLER_VARIANTS; v += 1) {
    urls.push(`${BASE}/api/filler/${lang}?v=${v}`);
  }
  urls.push(`${BASE}/api/check/${lang}`);
}

console.log(
  `warming ${urls.length} clips across ${langs.length} language(s) at ${BASE}, ` +
    `paced ${PACE_MS}ms (~${Math.round(60000 / PACE_MS)}/min)…`,
);

let ok = 0;
let fail = 0;
for (const url of urls) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      ok += 1;
      console.log(`  ok   ${url}`);
    } else {
      fail += 1;
      console.log(`  FAIL ${res.status} ${url}`);
    }
  } catch (e) {
    fail += 1;
    console.log(`  ERR  ${url} — ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, PACE_MS));
}

console.log(`\ndone: ${ok} ok, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
