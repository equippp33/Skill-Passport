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
export const SILENCE_ADVANCE_SECONDS = 8;

/**
 * Silence ladder: what to do, and when, while a candidate has said NOTHING at
 * all (not while they are mid-answer — that is `SILENCE_ADVANCE_SECONDS`).
 *
 * A real interviewer coaxes rather than sitting in dead air, but it never talks
 * over someone gathering their thoughts. The stages, in order:
 *  - 15s → a spoken check-in ("did you understand the question, or should I
 *    repeat it?"); their reply routes through the normal doubt/repeat/skip path.
 *  - 30s → a VISIBLE countdown starts ("skipping in Ns"), to prompt them.
 *  - 60s → auto-skip the question, unscored, and move on.
 * Any speech at all resets the ladder — it can never cut off someone talking.
 */
/**
 * The "would you like to add anything?" flow (streaming path only).
 *
 * On the first pause we don't submit — we ask if they want to add more and keep
 * the mic open. If they stay quiet this long after the ask, the stashed answer
 * is submitted on its own. Covers the short "add?" clip plus a few seconds of
 * real listening. A reply of at most this many words is read as a decline
 * ("no", "that's all") and dropped; anything longer is appended to the answer.
 */
export const ADD_WAIT_MS = 6000;
export const ADD_DECLINE_MAX_WORDS = 3;

/**
 * Only offer "add anything?" when the answer was SHORT — a barely-there reply
 * that probably has more behind it. If they actually spoke for longer than this
 * (measured from the first to the last partial transcript), they clearly said
 * their piece, so submit and move on without nagging.
 */
export const ADD_MAX_ANSWER_MS = 3000;

export const SILENCE_CHECK_IN_SECONDS = 15;
export const SILENCE_WARN_SECONDS = 30;
export const SILENCE_SKIP_SECONDS = 60;
export const NO_ANSWER_STAGES = [
  SILENCE_CHECK_IN_SECONDS,
  SILENCE_WARN_SECONDS,
  SILENCE_SKIP_SECONDS,
];
