/**
 * What one interview costs to run, in rupees.
 *
 * Development only. This is a running-cost readout for whoever is building the
 * thing, not an invoice — the real numbers come off the provider dashboards,
 * and this exists so a change that triples the token count is visible the same
 * afternoon rather than at the end of the month.
 *
 * ---------------------------------------------------------------------------
 * THE RATES BELOW ARE ESTIMATES. Check them against an actual bill before
 * quoting any of this to a customer. Provider pricing changes, differs per
 * account and per plan, and none of it is discoverable from the API.
 * ---------------------------------------------------------------------------
 *
 * Each counter is stored in the unit its provider bills in — see the usage
 * columns on `interview_attempts` — so the conversion happens here and only
 * here.
 */

/** Rupees per US dollar. Only OpenAI is billed in dollars. */
const USD_TO_INR = 88;

/**
 * OpenAI `gpt-4.1` list pricing, per million tokens.
 *
 * Only charged when `AI_PROVIDER=openai`; the default is Sarvam.
 */
const OPENAI_INPUT_USD_PER_MTOK = 2.0;
const OPENAI_OUTPUT_USD_PER_MTOK = 8.0;

/**
 * Sarvam, in rupees.
 *
 * The least certain numbers here — Sarvam prices in credits and the rate per
 * credit depends on the plan. Treat the total as an order of magnitude until
 * someone reconciles it against a statement.
 */
const SARVAM_INPUT_INR_PER_MTOK = 60;
const SARVAM_OUTPUT_INR_PER_MTOK = 240;
/** Speech-to-text, per request. Each answer segment is one request. */
const SARVAM_STT_INR_PER_REQUEST = 0.3;
/** Text-to-speech, per 1,000 characters synthesised. */
const SARVAM_TTS_INR_PER_KCHAR = 1.5;

/** The counters as they come off an attempt row. */
export interface InterviewUsage {
  sttRequests: number;
  ttsCharacters: number;
  llmInputTokens: number;
  llmOutputTokens: number;
}

/**
 * Total rupees for one interview.
 *
 * `provider` decides which model rates apply, because the brain is the part
 * that actually moves the number — STT and TTS are Sarvam either way.
 */
export function interviewCostInr(
  usage: InterviewUsage,
  provider: "sarvam" | "openai",
): number {
  const brain =
    provider === "openai"
      ? ((usage.llmInputTokens * OPENAI_INPUT_USD_PER_MTOK +
          usage.llmOutputTokens * OPENAI_OUTPUT_USD_PER_MTOK) /
          1_000_000) *
        USD_TO_INR
      : (usage.llmInputTokens * SARVAM_INPUT_INR_PER_MTOK +
          usage.llmOutputTokens * SARVAM_OUTPUT_INR_PER_MTOK) /
        1_000_000;

  const stt = usage.sttRequests * SARVAM_STT_INR_PER_REQUEST;
  const tts = (usage.ttsCharacters / 1000) * SARVAM_TTS_INR_PER_KCHAR;

  return brain + stt + tts;
}

/**
 * Formatted for a badge: `₹2.14`.
 *
 * Two decimals throughout. One interview costs single-digit rupees, so
 * rounding to whole rupees would show most of them as ₹2 and hide exactly the
 * differences this is meant to expose.
 */
export function formatInr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

/**
 * Whether the meter was actually running for this interview.
 *
 * Every interview synthesises at least its opener, so a run with zero TTS
 * characters did not have a meter on it at all — it predates the counters, or
 * predates one of the legs being instrumented. Those must read as "unknown",
 * never as ₹0.00: a zero is a claim that an interview was free, and showing
 * one next to a completed interview is how this readout loses its usefulness.
 */
export function wasMetered(usage: InterviewUsage): boolean {
  return usage.ttsCharacters > 0;
}
