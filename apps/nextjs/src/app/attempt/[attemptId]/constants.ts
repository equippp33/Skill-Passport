import type { SilenceStage } from "~/hooks/use-speech-activity";

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
 * What the interviewer does while a candidate says nothing at all.
 *
 * Silence is where a nervous fresher is most likely to be lost, and treating
 * it as an answer is how eight questions once went by with nobody speaking.
 * So: check they are still there, ask whether the question landed, and only
 * then stop waiting — the sequence a person would use.
 *
 * Ten seconds is a pause rather than an interruption. Five more and the
 * wording itself is the likely problem, so ask directly: "did you not follow
 * the question?" is answerable, and answering it with "no" routes straight to
 * the simpler version through the ordinary phrase matching. Forty is where
 * insisting stops being kind — and that rung submits **nothing**, it re-asks
 * the question, because a recording with no speech in it is not an answer
 * however confidently the transcriber fills it in.
 *
 * `at` counts candidate silence only; the clock freezes while a rung is being
 * spoken. `id` names the clip to play — see `AttemptStatus["clips"]`.
 */
export const NO_ANSWER_STAGES: SilenceStage[] = [
  { id: "whatHappened", at: 10 },
  { id: "didNotGet", at: 15 },
  { id: "noProblem", at: 40, final: true },
];

/**
 * Longest anything will wait on a spoken aside.
 *
 * A clip that never reports `ended` — a stalled download, a codec the browser
 * quietly gave up on — must not hold a candidate on a finished interview, or
 * freeze the silence ladder mid-answer. Twelve seconds is comfortably longer
 * than the longest of these lines.
 */
export const ASIDE_MAX_MS = 12_000;
