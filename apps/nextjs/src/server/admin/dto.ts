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
   * What this interview cost to run — development only, null in production.
   *
   * Sent ready-formatted ("₹2.14") rather than as counters or a number, so
   * neither the rate card nor the arithmetic reaches the browser bundle.
   */
  devCost: string | null;
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
   * What every interview under this link has cost so far — development only,
   * null in production.
   *
   * Carries the counts as well as the total, because a total over four metered
   * runs out of seven is a different claim from a total over all seven, and a
   * number without that context invites being quoted as if it were the whole
   * bill.
   */
  devCostTotal: {
    total: string;
    metered: number;
    unmetered: number;
  } | null;
}
