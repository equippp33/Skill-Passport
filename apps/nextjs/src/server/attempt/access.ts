import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";

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

/** A candidate may retake the same interview a few times, with a cooldown. */
export const MAX_ATTEMPTS_PER_CANDIDATE = 3;
export const ATTEMPT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export interface AttemptEligibility {
  allowed: boolean;
  /** Why not, when `allowed` is false. */
  reason?: "max_reached" | "cooldown";
  /** Completed attempts so far for this candidate on this interview. */
  attemptsUsed: number;
  maxAttempts: number;
  /** When the candidate may retake, for the cooldown case. */
  readyAt?: Date;
  /** Whole minutes until they may retake (>=1), for the cooldown case. */
  readyInMinutes?: number;
}

/**
 * Whether a candidate may (re)take this interview.
 *
 * A candidate — a partner student by `externalStudentId`, or an ordinary
 * candidate by email — gets up to {@link MAX_ATTEMPTS_PER_CANDIDATE} COMPLETED
 * attempts, and must wait {@link ATTEMPT_COOLDOWN_MS} after finishing one before
 * starting the next. Only completed attempts count: an abandoned or failed run
 * never burns a retry. With no identity to key on (an ordinary link where no
 * email was given) we cannot count, so we do not gate.
 */
export async function attemptEligibility(
  interviewId: string,
  candidate: { externalStudentId?: string | null; email?: string | null },
): Promise<AttemptEligibility> {
  const studentId = candidate.externalStudentId?.trim() || null;
  const email = candidate.email?.trim().toLowerCase() || null;

  if (!studentId && !email) {
    return {
      allowed: true,
      attemptsUsed: 0,
      maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE,
    };
  }

  // Key on the student id when present (integration links), else the email.
  const identity = studentId
    ? eq(interviewAttemptsTable.externalStudentId, studentId)
    : eq(interviewAttemptsTable.candidateEmail, email!);

  const completed = await db.query.interviewAttemptsTable.findMany({
    where: and(
      eq(interviewAttemptsTable.interviewId, interviewId),
      identity,
      eq(interviewAttemptsTable.status, "completed"),
    ),
    columns: { completedAt: true },
    orderBy: desc(interviewAttemptsTable.completedAt),
  });

  const attemptsUsed = completed.length;
  if (attemptsUsed >= MAX_ATTEMPTS_PER_CANDIDATE) {
    return {
      allowed: false,
      reason: "max_reached",
      attemptsUsed,
      maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE,
    };
  }

  const latest = completed[0]?.completedAt ?? null;
  if (latest) {
    const readyAt = new Date(latest.getTime() + ATTEMPT_COOLDOWN_MS);
    const remainingMs = readyAt.getTime() - Date.now();
    if (remainingMs > 0) {
      return {
        allowed: false,
        reason: "cooldown",
        attemptsUsed,
        maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE,
        readyAt,
        readyInMinutes: Math.max(1, Math.ceil(remainingMs / 60_000)),
      };
    }
  }

  return {
    allowed: true,
    attemptsUsed,
    maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE,
  };
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
