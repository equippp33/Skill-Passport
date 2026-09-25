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
  /**
   * What this interview cost to run — development only, null in production and
   * null for any interview the meter did not cover.
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
   * True when `devCost` is a FLOOR rather than the whole bill.
   *
   * An interview that ran before the meter existed still has its question text
   * and its recorded answers, so speech can be priced exactly — but nothing
   * recorded the model tokens, which are the larger share. Showing the speech
   * total alone as if it were the cost would understate it roughly threefold,
   * so the card marks it "≥" instead.
   */
  devCostIsFloor?: boolean;
  createdAt: Date;
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
  /**
   * What every interview under this link has cost, split by provider —
   * development only, absent in production.
   *
   * There is no separate line for the WebSocket. Sarvam bills realtime
   * speech-to-text by the second of audio, not by connection, so the socket's
   * cost IS the STT line; a relay connection of its own costs nothing.
   */
  devCosts?: {
    /** "Sarvam" or "OpenAI" — whichever `AI_PROVIDER` selects. */
    modelLabel: string;
    openai: string;
    tts: string;
    stt: string;
    total: string;
    metered: number;
    unmetered: number;
    /** Some of the total is a floor — see `devCostIsFloor`. */
    hasFloor: boolean;
  };
}
