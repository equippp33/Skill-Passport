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
 * Model tokens are split by the provider that actually served the call rather
 * than totalled, because the same token costs about six times more at OpenAI
 * than at Sarvam (₹176 against ₹29.28 per million input). One combined figure
 * could only be priced by assuming a provider, and that assumption is wrong
 * for every call the Sarvam circuit breaker handed to OpenAI — the calls that
 * are least visible and most expensive.
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
  openaiInputTokens: number;
  openaiOutputTokens: number;
  sarvamInputTokens: number;
  sarvamOutputTokens: number;
}

export interface CostBreakdown {
  stt: number;
  tts: number;
  openai: number;
  sarvam: number;
  /** The model bill whoever served it — `openai + sarvam`. */
  llm: number;
  total: number;
}

/**
 * Rupees for one interview, split by leg.
 *
 * Each provider's tokens are priced at that provider's own rate, so there is
 * nothing to tell this function about which brain is configured: an interview
 * that ran half on each is costed correctly without being asked.
 */
export function interviewCost(usage: InterviewUsage): CostBreakdown {
  const stt = usage.sttMinutes * SARVAM_STT_INR_PER_MINUTE;
  const tts = usage.ttsCharacters * SARVAM_TTS_INR_PER_CHAR;

  const openai =
    ((usage.openaiInputTokens * OPENAI_INPUT_USD_PER_MTOK +
      usage.openaiOutputTokens * OPENAI_OUTPUT_USD_PER_MTOK) /
      1_000_000) *
    USD_TO_INR;

  const sarvam =
    (usage.sarvamInputTokens * SARVAM_INPUT_INR_PER_MTOK +
      usage.sarvamOutputTokens * SARVAM_OUTPUT_INR_PER_MTOK) /
    1_000_000;

  const llm = openai + sarvam;
  return { stt, tts, openai, sarvam, llm, total: stt + tts + llm };
}

/* ------------------------- Reconstructing Sarvam ------------------------- */

/**
 * Sarvam's tokens were not recorded until 6 October 2026, because the Sarvam
 * client never called `recordUsage` — the OpenAI client was the only caller.
 * Tokens leave no trace once the response is parsed, so those interviews can
 * never be costed from stored data. They can, however, be MODELLED, and a
 * modelled figure is far closer to the truth than the ₹0.00 that stood there
 * before, which read as "Sarvam was free".
 *
 * The constants below are fitted on the 331 interviews that ran on OpenAI and
 * so were metered exactly. Both providers go through the same
 * `requestStructured` contract with the same instructions and the same input,
 * so a turn costs about the same number of tokens whoever answers it.
 *
 * Fitted: 1.95 requests per turn, 5,015 input and 165 output tokens per turn.
 * Validated by fitting on half those interviews and predicting the other half:
 * the aggregate came out 0.3% low on input and 3.4% high on output. Per
 * interview it is far looser — about 30% — so this belongs on a total across
 * many runs, and a single interview's figure should be read as an order of
 * magnitude.
 *
 * It UNDERSTATES slightly: Sarvam's system message carries an extra
 * `describeShape(jsonSchema)` block that OpenAI's does not.
 */
const REQUESTS_PER_TURN = 1.95;
const INPUT_TOKENS_PER_REQUEST = 5015 / REQUESTS_PER_TURN;
const OUTPUT_TOKENS_PER_REQUEST = 165 / REQUESTS_PER_TURN;

/**
 * What Sarvam must have done on an interview that did not record it.
 *
 * `openaiRequests` is subtracted because those turns are already costed
 * exactly from stored tokens — an interview the breaker handed to OpenAI
 * part-way through must not be billed twice for the same turns. An interview
 * that ran wholly on OpenAI leaves nothing over, which is the right answer.
 */
export function estimateSarvamUsage(
  turns: number,
  openaiRequests: number,
): { sarvamInputTokens: number; sarvamOutputTokens: number } {
  const unbilled = Math.max(0, turns * REQUESTS_PER_TURN - openaiRequests);
  return {
    sarvamInputTokens: Math.round(unbilled * INPUT_TOKENS_PER_REQUEST),
    sarvamOutputTokens: Math.round(unbilled * OUTPUT_TOKENS_PER_REQUEST),
  };
}

/**
 * Whether the SPEECH meter was running for this interview.
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
 * Whether the MODEL meter was running, which is a separate question.
 *
 * No interview can run without the model: it writes every question and scores
 * every answer. So zero tokens never means a cheap interview, it means nobody
 * was counting — which was true of every Sarvam-brained interview until the
 * Sarvam client started reporting its usage, because only the OpenAI client
 * ever called `recordUsage`. Those runs have exact speech costs and a missing
 * model share, so they are shown as a floor rather than as the bill.
 */
export function hasModelUsage(usage: {
  llmInputTokens: number;
  llmOutputTokens: number;
  sarvamInputTokens: number;
  sarvamOutputTokens: number;
}): boolean {
  return (
    usage.llmInputTokens > 0 ||
    usage.llmOutputTokens > 0 ||
    usage.sarvamInputTokens > 0 ||
    usage.sarvamOutputTokens > 0
  );
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
