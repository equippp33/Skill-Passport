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

/**
 * The multi-part opening asks the next bit (hobbies, then location) after each
 * is answered, mic still recording. If the candidate stays silent on a bit this
 * long, move on to the next bit rather than stalling the interview at the start.
 * Cancelled the moment they start speaking (see the partial-transcript effect).
 */
export const OPENING_BIT_WAIT_MS = 10000;

/**
 * Quiet after SPEAKING before the interviewer reacts.
 *
 * Short, because by now the candidate has answered and stopped; this is the
 * beat before "would you like to add anything?". Long enough to ride out a
 * breath between sentences, which the VAD has already endpointed.
 */
export const ANSWER_PAUSE_SECONDS = 3;

/**
 * Words needed before the interview treats the candidate as having ANSWERED.
 *
 * Not the voice detector, and not "any transcript at all". The speech model
 * invents short phrases out of silence and background noise — "Okay, so",
 * "और आवुलिया" — and the detector trips on the same noise. Either signal on its
 * own made a silent candidate look as though they had answered: they were
 * offered "anything to add?", the countdown ran, and the question moved on
 * without them saying a word.
 *
 * Three words clears those fragments while still counting any real answer.
 * A genuine one-or-two-word reply is treated as not-yet-answered, which only
 * means it gets the gentle check-in instead of the countdown.
 */
export const MIN_ANSWER_WORDS = 3;

/**
 * Longest answer that is still offered "would you like to add anything?".
 *
 * Only a SHORT answer has obviously more behind it. Asking after every answer
 * became monotonous by the third or fourth question (client feedback), so a
 * fuller answer gets just the on-screen countdown — same timing, no clip.
 */
export const ADD_PROMPT_MAX_WORDS = 8;

/**
 * How long the Next button stays disabled after the question finishes playing.
 *
 * Candidates were tapping Next the moment the question ended, before giving
 * themselves a chance to answer (client feedback). Counted from the end of
 * the question audio, so the whole wait is time they could have spent
 * answering.
 */
export const NEXT_BUTTON_DELAY_SECONDS = 10;

/**
 * Quiet with NOTHING said yet, before asking whether they followed it.
 *
 * Fifteen seconds. Someone who has not started after that long is usually
 * stuck rather than thinking, and the ask is gentle enough that interrupting
 * a slow starter costs them little — any speech cancels what follows.
 */
export const SILENCE_CHECK_IN_SECONDS = 15;

/**
 * The visible countdown shown once a spoken prompt has FINISHED playing.
 *
 * Seven rather than five: the clip has to be fetched and decoded before the
 * candidate hears a word, and starting the clock at the ask rather than the
 * answer would spend a chunk of it on audio nobody has heard yet. Counted
 * from the moment the clip ends, so the candidate gets the whole of it.
 */
export const PROMPT_COUNTDOWN_SECONDS = 7;

/**
 * Last resort for a candidate who never speaks at all.
 *
 * No countdown is shown for this one and nothing is said: it exists only so a
 * question cannot hang for ever when somebody walks away from the screen.
 * Long on purpose — anybody still thinking has had the check-in and can take
 * as long as they like.
 */
export const SILENCE_GIVE_UP_SECONDS = 60;

/**
 * The silence ladder, in seconds since they last stopped speaking.
 *
 * Which rung applies depends on whether they have said anything at all:
 * somebody who answered gets the first, somebody still staring at the
 * question gets the second and, eventually, the third. See
 * `handleSilenceStage`.
 */
export const NO_ANSWER_STAGES = [
  ANSWER_PAUSE_SECONDS,
  SILENCE_CHECK_IN_SECONDS,
  SILENCE_GIVE_UP_SECONDS,
];
