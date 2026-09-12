/**
 * Client-side interview timings.
 *
 * Recording limits come from `~/server/interview/validation`, which is the
 * single source shared with the server — these are the polling knobs the UI
 * needs on top of them.
 */
export { MAX_ANSWER_SECONDS } from "~/server/interview/validation";

/**
 * Poll interval while an answer is being processed. Kept fairly tight so the
 * next question appears soon after the server has it ready, rather than up to a
 * full two seconds later — that tail was pure perceived latency.
 */
export const POLL_INTERVAL_MS = 1000;

/** Give up polling after this long and offer a manual retry. */
export const POLL_TIMEOUT_MS = 3 * 60 * 1000;

/** Shortest answer the Next button will accept, in seconds. */
export const MIN_ANSWER_SECONDS = 2;

/**
 * Smallest blob worth uploading. Below this the recording is effectively
 * silence and Sarvam would return an empty transcript.
 */
export const MIN_ANSWER_BLOB_BYTES = 1024;

/**
 * If the question audio neither ends nor errors within this window, start
 * recording anyway. Purely a safety net — the `ended` event normally fires
 * long before it.
 */
export const AUTO_START_BACKSTOP_MS = 60_000;

/**
 * Silence after speaking that ends the answer and moves on by itself.
 *
 * Long enough to sit through a mid-answer pause for thought, short enough
 * that finishing a sentence and waiting feels like a conversation rather
 * than a form. The candidate sees it count down and can still press Next.
 */
export const SILENCE_ADVANCE_SECONDS = 4;
