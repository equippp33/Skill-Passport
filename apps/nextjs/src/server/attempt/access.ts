import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { interviewAttemptsTable, interviewsTable } from "~/server/db/schema";
import type { Interview, InterviewAttempt } from "~/server/db/schema";

/**
 * Candidate access control.
 *
 * Candidates have no account — they arrive through a shared public link, so
 * anyone with the link can start an attempt. What must NOT be shared is an
 * attempt in progress: one candidate must never read another's answers or
 * results, even though they used the same link.
 *
 * Each attempt therefore gets its own bearer token, returned only once and
 * kept in an httpOnly cookie. Every candidate-side read requires both the
 * attempt id (from the URL) and a cookie token that matches that exact row.
 * Guessing the id is not enough, and the token is never in a URL, so it does
 * not leak through history, referrers or a shared screenshot.
 */

const ATTEMPT_COOKIE = "sp_attempt";
/** Long enough to finish and review; short enough not to linger on a shared PC. */
const ATTEMPT_COOKIE_MAX_AGE = 60 * 60 * 6;

export async function setAttemptCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(ATTEMPT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ATTEMPT_COOKIE_MAX_AGE,
  });
}

export async function clearAttemptCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ATTEMPT_COOKIE);
}

export async function readAttemptCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(ATTEMPT_COOKIE)?.value ?? null;
}

/** Constant-time compare, so a token cannot be recovered by timing. */
function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface AttemptContext {
  attempt: InterviewAttempt;
  interview: Interview;
}

/**
 * Load an attempt only if the caller holds its token.
 *
 * Returns null for a wrong or missing cookie, exactly as it does for a
 * non-existent attempt — a candidate poking at ids learns nothing either way.
 */
export async function getAttemptForCandidate(
  attemptId: string,
): Promise<AttemptContext | null> {
  const token = await readAttemptCookie();
  if (!token) return null;

  const rows = await db
    .select({ attempt: interviewAttemptsTable, interview: interviewsTable })
    .from(interviewAttemptsTable)
    .innerJoin(
      interviewsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(eq(interviewAttemptsTable.id, attemptId))
    .limit(1);

  const found = rows[0];
  if (!found) return null;
  if (!tokensMatch(found.attempt.accessToken, token)) return null;

  return found;
}

/** The interview behind a share link, or null if the token is wrong/closed. */
export async function getInterviewByPublicToken(
  publicToken: string,
): Promise<Interview | null> {
  const found = await db.query.interviewsTable.findFirst({
    where: and(
      eq(interviewsTable.publicToken, publicToken),
      eq(interviewsTable.isOpen, true),
    ),
  });
  return found ?? null;
}
