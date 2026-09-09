/**
 * Report the live rate limits for the OpenAI and Sarvam keys in .env.
 *
 *   pnpm --filter @skill-passport/nextjs check:limits
 *
 * Providers publish their limits in response headers rather than an endpoint,
 * so this makes one deliberately tiny real request to each and prints what
 * comes back. Cost is negligible (a few tokens, a few words of speech), but it
 * is a real call — do not run it in a loop.
 *
 * Interpreting the OpenAI numbers for this app: one interview makes
 * 1 (first question) + N (one per answer) + 1 (summary) requests, so a
 * 10-question interview is ~12 OpenAI requests spread over its whole length.
 * Sarvam sees roughly 2 requests per turn (transcribe + speak).
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
loadEnv({ path: "../../.env" });

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

function line(label, value) {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

/* ------------------------------- OpenAI ---------------------------------- */

async function checkOpenAI() {
  console.log("\n=== OpenAI ===");
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.log(`  ${DIM}OPENAI_API_KEY is not set — skipped.${OFF}`);
    return;
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      // Smallest possible real request.
      body: JSON.stringify({ model, input: "hi", max_output_tokens: 16 }),
    });
  } catch (error) {
    console.log(`  ${RED}network error:${OFF} ${error.message}`);
    return;
  }

  line("status", `${response.status} ${response.statusText}`);
  if (response.status === 401) {
    console.log(`  ${RED}key rejected — check OPENAI_API_KEY.${OFF}`);
    return;
  }
  if (response.status === 429) {
    console.log(
      `  ${RED}rate limited or out of quota — check billing on the dashboard.${OFF}`,
    );
  }

  const h = response.headers;
  line("requests / min", h.get("x-ratelimit-limit-requests") ?? "not reported");
  line("requests remaining", h.get("x-ratelimit-remaining-requests") ?? "—");
  line("tokens / min", h.get("x-ratelimit-limit-tokens") ?? "not reported");
  line("tokens remaining", h.get("x-ratelimit-remaining-tokens") ?? "—");
  line("resets in (requests)", h.get("x-ratelimit-reset-requests") ?? "—");

  const rpm = Number(h.get("x-ratelimit-limit-requests"));
  if (Number.isFinite(rpm) && rpm > 0) {
    // ~12 requests per 10-question interview, spread over ~20 minutes, but
    // the burst that matters is everyone submitting an answer at once.
    console.log(
      `  ${GREEN}=> roughly ${Math.floor(rpm / 2)} candidates could submit an answer in the same minute.${OFF}`,
    );
  }
}

/* ------------------------------- Sarvam ---------------------------------- */

async function checkSarvam() {
  console.log("\n=== Sarvam ===");
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    console.log(`  ${DIM}SARVAM_API_KEY is not set — skipped.${OFF}`);
    return;
  }

  let response;
  try {
    response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "test",
        language_code: process.env.SARVAM_LANGUAGE_CODE ?? "en-IN",
        speaker: process.env.SARVAM_TTS_SPEAKER ?? "shubh",
        model: process.env.SARVAM_TTS_MODEL ?? "bulbul:v3",
      }),
    });
  } catch (error) {
    console.log(`  ${RED}network error:${OFF} ${error.message}`);
    return;
  }

  line("status", `${response.status} ${response.statusText}`);
  if (response.status === 401 || response.status === 403) {
    console.log(`  ${RED}key rejected — check SARVAM_API_KEY.${OFF}`);
    return;
  }
  if (response.status === 429) {
    console.log(`  ${RED}rate limited right now.${OFF}`);
  }

  // Sarvam does not document rate-limit headers; print any that appear so
  // this keeps working if they add them.
  const interesting = [...response.headers.entries()].filter(([name]) =>
    /ratelimit|quota|retry-after|x-request/i.test(name),
  );
  if (interesting.length === 0) {
    console.log(
      `  ${DIM}no rate-limit headers returned — Sarvam does not publish them.${OFF}`,
    );
    console.log(
      `  ${DIM}check your plan's limit at dashboard.sarvam.ai.${OFF}`,
    );
  } else {
    for (const [name, value] of interesting) line(name, value);
  }
}

await checkOpenAI();
await checkSarvam();
console.log("");
