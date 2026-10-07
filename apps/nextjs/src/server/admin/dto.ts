/**
 * Shapes returned by admin server actions.
 *
 * Kept apart from `service.ts` (which is `server-only`) and from `actions.ts`
 * (a `"use server"` module, which may only export async functions) so a
 * client component can import the types without pulling in either.
 *
 * These are deliberately narrower than the database rows: an action's return
 * value crosses to the browser, so it carries what the UI renders and
 * nothing more.
 */

/** Discriminated so the caller cannot read an id off a failure. */
export type CreateInterviewResult =
  { ok: true; interviewId: string } | { ok: false; error: string };

export interface AttemptSummary {
  id: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  status: string;
  language: string | null;
  /** First recorded answer clip, used as the card thumbnail. Null until one exists. */
  thumbnailVideoId: string | null;
  /**
   * Every language actually heard in their answers, most-used first.
   * Distinct from `language`, which is the one the interview is conducted
   * in — a candidate can and does switch mid-interview.
   */
  spokenLanguages: { code: string; label: string; turns: number }[];
  overallScore: number | null;
  awayCount: number;
  /** How many attempts this candidate made at this interview (1 = no retake). */
  attemptCount: number;
  /**
   * What this CANDIDATE cost — every attempt they made here, added together.
   * Development only, null in production and null when the meter covered none
   * of them.
   *
   * The card is one per candidate (`collapseByCandidate`), so a total over the
   * single attempt it happens to show would leave out the retakes the "N
   * attempts" marker right beside it is announcing.
   *
   * Sent ready-formatted ("₹12.30") rather than as counters or a number, so
   * neither the rate card nor the arithmetic reaches the browser bundle.
   *
   * Three states, and the card needs all three: a string is a real cost,
   * `null` means development but this interview was never metered, and the
   * field is ABSENT in production so the badge does not render at all.
   */
  devCost?: string | null;
  /** The same figure split by provider, for the card's tooltip. */
  devCostParts?: string | null;
  /**
   * True when part of `devCost` is MODELLED rather than measured.
   *
   * Sarvam recorded no tokens before 6 October 2026, and tokens leave no trace
   * once the reply is parsed, so those interviews can never be costed from
   * stored data. Their Sarvam share is reconstructed from how many questions
   * the interview actually got through — accurate in aggregate, loose on any
   * single run — and the card marks it "~" so nobody reads a modelled figure
   * as a measured one.
   */
  devCostIsEstimated?: boolean;
  createdAt: Date;
}

/** One repeat candidate's attempts, oldest first, for the retake-comparison table. */
export interface RepeatCandidate {
  /** Attempt to open when the row is clicked (their latest). */
  reportAttemptId: string;
  candidateName: string;
  candidateEmail: string | null;
  /** Overall score (0-10) per attempt, oldest first; null if that run was unscored. */
  attempts: { overallScore: number | null; status: string }[];
}

export interface InterviewDetails {
  id: string;
  title: string;
  description: string | null;
  questionCount: number;
  publicToken: string;
  isOpen: boolean;
  createdAt: Date;
  attempts: AttemptSummary[];
  /** Every candidate with 2+ attempts, for the retake-comparison table. */
  repeatComparison?: RepeatCandidate[];
  /**
   * What every interview under this link has cost, split by provider —
   * development only, absent in production.
   *
   * There is no separate line for the WebSocket. Sarvam bills realtime
   * speech-to-text by the second of audio, not by connection, so the socket's
   * cost IS the STT line; a relay connection of its own costs nothing.
   */
  devCosts?: {
    /**
     * The two model bills, separately.
     *
     * Not one "model" line chosen by `AI_PROVIDER`: a token costs about six
     * times more at OpenAI than at Sarvam, and the circuit breaker moves work
     * between them mid-interview, so a single line could only be right by
     * luck. Either may be ₹0.00, which is a real answer — that provider did
     * no work under this link.
     */
    openai: string;
    sarvam: string;
    tts: string;
    stt: string;
    total: string;
    /**
     * Per COMPLETED interview — null when none have completed.
     *
     * Deliberately not `total / attempts`: two in three attempts are abandoned
     * part-way and cost a rupee or two, so that figure answers "what does an
     * attempt cost" when the question being asked is "what does an interview
     * cost".
     */
    average: string | null;
    /** How many completed interviews `average` is over. */
    averageBasis: number;
    /** Attempts whose model usage was recorded outright, nothing modelled. */
    measured: number;
    /** Attempts whose Sarvam share had to be reconstructed. */
    estimatedCount: number;
    /** Some of the total is modelled — the figures carry a "~". */
    hasEstimate: boolean;
    /** Some of the SPEECH came from stored question text, so it is low. */
    hasFloor: boolean;
  };
}
