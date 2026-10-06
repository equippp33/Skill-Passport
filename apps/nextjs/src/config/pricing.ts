/**
 * What one interview costs to run, in rupees.
 *
 * Development only. This is a running-cost readout for whoever is building the
 * thing, not an invoice — it exists so a change that triples the token count or
 * the clip count is visible the same afternoon rather than at the end of the
 * month.
 *
 * The rates below are the providers' published list prices, checked on
 * 23 September 2026:
 *
 *   Sarvam   https://docs.sarvam.ai/api/getting-started/pricing
 *   OpenAI   https://developers.openai.com/api/docs/pricing
 *
 * They are still list prices. A negotiated contract, a promotional credit or a
 * plan change will move them, so treat a total here as the right order of
 * magnitude and the comparison between two interviews as exact.
 */

/** Rupees per US dollar. Only OpenAI bills in dollars. */
const USD_TO_INR = 88;

/* ------------------------------- Sarvam ---------------------------------- */

/** Speech to text: ₹30 per hour, billed per second. */
const SARVAM_STT_INR_PER_MINUTE = 30 / 60;

/** `bulbul:v3`: ₹30 per 10,000 characters, rounded to the nearest character. */
const SARVAM_TTS_INR_PER_CHAR = 30 / 10_000;

/** `sarvam-105b`, per million tokens. Both variants price the same. */
const SARVAM_INPUT_INR_PER_MTOK = 29.28;
const SARVAM_OUTPUT_INR_PER_MTOK = 73.2;

/* ------------------------------- OpenAI ---------------------------------- */

/** `gpt-4.1` standard processing, per million tokens, in USD. */
const OPENAI_INPUT_USD_PER_MTOK = 2.0;
const OPENAI_OUTPUT_USD_PER_MTOK = 8.0;

/**
 * What an interview used.
 *
 * Speech-to-text is counted in MINUTES OF AUDIO rather than requests, because
 * that is how Sarvam bills it — and because the streaming path does not make
 * requests at all, it holds a socket open. The minutes come from the recorded
 * answer clips, which are measured by the browser and stored either way, so
 * this stays correct whichever transcription path ran.
 */
export interface InterviewUsage {
  sttMinutes: number;
  ttsCharacters: number;
  llmInputTokens: number;
  llmOutputTokens: number;
}

export interface CostBreakdown {
  stt: number;
  tts: number;
  llm: number;
  total: number;
}

/**
 * Rupees for one interview, split by leg.
 *
 * `provider` decides which model rates apply. Speech is Sarvam either way —
 * only the brain moves.
 */
export function interviewCost(
  usage: InterviewUsage,
  provider: "sarvam" | "openai",
): CostBreakdown {
  const stt = usage.sttMinutes * SARVAM_STT_INR_PER_MINUTE;
  const tts = usage.ttsCharacters * SARVAM_TTS_INR_PER_CHAR;

  const llm =
    provider === "openai"
      ? ((usage.llmInputTokens * OPENAI_INPUT_USD_PER_MTOK +
          usage.llmOutputTokens * OPENAI_OUTPUT_USD_PER_MTOK) /
          1_000_000) *
        USD_TO_INR
      : (usage.llmInputTokens * SARVAM_INPUT_INR_PER_MTOK +
          usage.llmOutputTokens * SARVAM_OUTPUT_INR_PER_MTOK) /
        1_000_000;

  return { stt, tts, llm, total: stt + tts + llm };
}

/**
 * Whether the meter was running for this interview.
 *
 * Every interview synthesises at least its opening question, so a run with no
 * TTS characters was never metered — it predates the counters, or predates one
 * of the legs being instrumented. Those must read as "unknown", never as
 * ₹0.00: a zero is a claim that an interview was free, and showing one next to
 * a completed interview is how a readout like this stops being believed.
 */
export function wasMetered(usage: { ttsCharacters: number }): boolean {
  return usage.ttsCharacters > 0;
}

/**
 * Formatted for a badge: `₹12.30`.
 *
 * Two decimals throughout. One interview costs tens of rupees, so rounding to
 * whole ones would hide exactly the differences this is meant to expose.
 */
export function formatInr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}
