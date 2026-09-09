import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { User } from "lucia";

import { db } from "~/server/db";
import {
  interviewAttemptsTable,
  interviewsTable,
  usersTable,
} from "~/server/db/schema";
import type { Interview, InterviewAttempt } from "~/server/db/schema";
import { getAuth } from "~/server/auth/session";
import { DEFAULT_QUESTION_COUNT } from "~/server/interview/validation";

/**
 * Admin side: creating interviews and reviewing candidate attempts.
 *
 * Every read and write here is scoped to the signed-in admin's user id, and
 * `requireAdmin()` is the only way into this module — a candidate has no Lucia
 * account at all, so there is nothing for them to escalate from.
 */

/** URL-safe, unguessable. 32 bytes ≈ 256 bits of entropy. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
}

/**
 * Gate for every admin page and server action.
 *
 * The role is re-read from the database rather than trusted from the session,
 * so revoking an admin takes effect on their next request instead of when
 * their cookie eventually expires.
 */
export async function requireAdmin(returnTo?: string): Promise<AdminUser> {
  const { user } = await getAuth();
  if (!user) {
    redirect(
      returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login",
    );
  }

  const row = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, (user as User).id),
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      mustChangePassword: true,
    },
  });

  if (!row || row.role !== "admin") {
    // Not an error page: an account without the role has no admin area to be
    // told about.
    redirect("/login");
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    mustChangePassword: row.mustChangePassword,
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Interviews                                 */
/* -------------------------------------------------------------------------- */

export async function createInterview(
  adminId: string,
  input: { title: string; description: string | null; questionCount?: number },
): Promise<Interview> {
  const [row] = await db
    .insert(interviewsTable)
    .values({
      createdByUserId: adminId,
      title: input.title,
      description: input.description,
      questionCount: input.questionCount ?? DEFAULT_QUESTION_COUNT,
      publicToken: generateToken(),
    })
    .returning();

  if (!row) throw new Error("Failed to create interview");
  return row;
}

export interface InterviewWithCounts extends Interview {
  attemptCount: number;
  completedCount: number;
}

export async function listInterviews(
  adminId: string,
): Promise<InterviewWithCounts[]> {
  const rows = await db
    .select({
      interview: interviewsTable,
      attemptCount: sql<number>`count(${interviewAttemptsTable.id})::int`,
      completedCount: sql<number>`count(*) filter (where ${interviewAttemptsTable.status} = 'completed')::int`,
    })
    .from(interviewsTable)
    .leftJoin(
      interviewAttemptsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(eq(interviewsTable.createdByUserId, adminId))
    .groupBy(interviewsTable.id)
    .orderBy(desc(interviewsTable.createdAt))
    .limit(100);

  return rows.map((r) => ({
    ...r.interview,
    attemptCount: r.attemptCount,
    completedCount: r.completedCount,
  }));
}

/** Ownership is part of the predicate, never checked afterwards. */
export async function getInterviewForAdmin(
  adminId: string,
  interviewId: string,
): Promise<{ interview: Interview; attempts: InterviewAttempt[] } | null> {
  const interview = await db.query.interviewsTable.findFirst({
    where: and(
      eq(interviewsTable.id, interviewId),
      eq(interviewsTable.createdByUserId, adminId),
    ),
  });
  if (!interview) return null;

  const attempts = await db.query.interviewAttemptsTable.findMany({
    where: eq(interviewAttemptsTable.interviewId, interview.id),
    orderBy: desc(interviewAttemptsTable.createdAt),
    limit: 500,
  });

  return { interview, attempts };
}

export async function setInterviewOpen(
  adminId: string,
  interviewId: string,
  isOpen: boolean,
): Promise<void> {
  await db
    .update(interviewsTable)
    .set({ isOpen, updatedAt: new Date() })
    .where(
      and(
        eq(interviewsTable.id, interviewId),
        eq(interviewsTable.createdByUserId, adminId),
      ),
    );
}

/**
 * One candidate's attempt, for the admin review page.
 *
 * Joined through `interviews` so an admin can only open attempts belonging to
 * an interview they created.
 */
export async function getAttemptForAdmin(
  adminId: string,
  attemptId: string,
): Promise<{ attempt: InterviewAttempt; interview: Interview } | null> {
  const rows = await db
    .select({ attempt: interviewAttemptsTable, interview: interviewsTable })
    .from(interviewAttemptsTable)
    .innerJoin(
      interviewsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(
      and(
        eq(interviewAttemptsTable.id, attemptId),
        eq(interviewsTable.createdByUserId, adminId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export interface AdminStats {
  interviews: number;
  openInterviews: number;
  attempts: number;
  completed: number;
  inProgress: number;
  averageScore: number | null;
}

/**
 * Headline numbers for the overview.
 *
 * One aggregate query rather than counting rows in JS, so it stays cheap as
 * attempts accumulate. Scoped to this admin's interviews throughout.
 */
export async function getAdminStats(adminId: string): Promise<AdminStats> {
  const [interviewRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${interviewsTable.isOpen})::int`,
    })
    .from(interviewsTable)
    .where(eq(interviewsTable.createdByUserId, adminId));

  const [attemptRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${interviewAttemptsTable.status} = 'completed')::int`,
      inProgress: sql<number>`count(*) filter (where ${interviewAttemptsTable.status} in ('in_progress','processing'))::int`,
      averageScore: sql<
        number | null
      >`avg(${interviewAttemptsTable.overallScore}) filter (where ${interviewAttemptsTable.overallScore} is not null)`,
    })
    .from(interviewAttemptsTable)
    .innerJoin(
      interviewsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(eq(interviewsTable.createdByUserId, adminId));

  return {
    interviews: interviewRow?.total ?? 0,
    openInterviews: interviewRow?.open ?? 0,
    attempts: attemptRow?.total ?? 0,
    completed: attemptRow?.completed ?? 0,
    inProgress: attemptRow?.inProgress ?? 0,
    averageScore:
      attemptRow?.averageScore === null ||
      attemptRow?.averageScore === undefined
        ? null
        : Math.round(Number(attemptRow.averageScore)),
  };
}
