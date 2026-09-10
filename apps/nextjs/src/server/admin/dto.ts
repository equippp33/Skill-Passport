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
  status: string;
  language: string | null;
  /**
   * Every language actually heard in their answers, most-used first.
   * Distinct from `language`, which is the one the interview is conducted
   * in — a candidate can and does switch mid-interview.
   */
  spokenLanguages: { code: string; label: string; turns: number }[];
  overallScore: number | null;
  awayCount: number;
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
}
