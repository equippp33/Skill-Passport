import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { User } from "lucia";

import { after } from "next/server";

import { db } from "~/server/db";
import { sweepAbandonedAttempts } from "~/server/attempt/service";
import {
  interviewAttemptsTable,
  interviewAudioTable,
  interviewTurnsTable,
  interviewsTable,
  usersTable,
} from "~/server/db/schema";
import type { Interview, InterviewAttempt } from "~/server/db/schema";
import type { InterviewDetails } from "./dto";
import { isWorkSkillId } from "~/config/work-skills";
import { formatInr, interviewCostInr, wasMetered } from "~/config/pricing";
import { env } from "~/env";
import { deleteAudioObject } from "~/server/interview/storage";
import type { WorkSkillId } from "~/config/work-skills";
import { labelForCode } from "~/lib/spoken-languages";
import type { SpokenLanguage } from "~/lib/spoken-languages";
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
  input: {
    title: string;
    description: string | null;
    questionCount?: number;
    followUpSkills?: WorkSkillId[];
  },
): Promise<Interview> {
  // Only real skill ids reach the column, whatever the caller passed.
  const followUpSkills = (input.followUpSkills ?? []).filter(isWorkSkillId);

  const [row] = await db
    .insert(interviewsTable)
    .values({
      createdByUserId: adminId,
      title: input.title,
      description: input.description,
      questionCount: input.questionCount ?? DEFAULT_QUESTION_COUNT,
      followUpSkills,
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

/**
 * Create an interview with nothing to fill in.
 *
 * Every interview is the same ten workplace skills, and the language comes
 * from how the candidate answers, so there is no configuration to collect.
 * The title exists only so an admin can tell two links apart and is numbered
 * from how many they already have. Two simultaneous creates can land on the
 * same number — nothing depends on it being unique, and the share token is
 * what actually identifies an interview.
 */
export async function createGeneralInterview(
  adminId: string,
  followUpSkills: WorkSkillId[] = [],
): Promise<Interview> {
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(interviewsTable)
    .where(eq(interviewsTable.createdByUserId, adminId));

  return createInterview(adminId, {
    title: `General interview ${(counted?.total ?? 0) + 1}`,
    description: null,
    followUpSkills,
  });
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

/* -------------------------------------------------------------------------- */
/*                              Views for the UI                              */
/* -------------------------------------------------------------------------- */

/**
 * One interview plus its candidates, shaped for the dialog.
 *
 * Narrower than the rows themselves: this crosses to the browser, so it
 * carries what the dialog renders and nothing else — no access tokens, no
 * transcripts.
 */
export async function getInterviewDetails(
  adminId: string,
  interviewId: string,
): Promise<InterviewDetails | null> {
  const found = await getInterviewForAdmin(adminId, interviewId);
  if (!found) return null;

  const { interview, attempts } = found;

  /**
   * Tidy up interviews nobody is sitting in any more.
   *
   * In `after()` so it never delays the page: the sweep scores and writes a
   * report for each abandoned attempt, which takes provider calls. The list
   * this render returns may therefore still show one as running; the grid
   * re-fetches while anything is in progress, so it corrects itself within
   * seconds rather than needing a reload.
   */
  after(async () => {
    await sweepAbandonedAttempts(
      new Map([[interview.id, interview]]),
      attempts,
    );
  });

  const attemptIds = attempts.map((a) => a.id);
  const [spokenByAttempt, thumbnailByAttempt] = await Promise.all([
    getSpokenLanguages(attemptIds),
    getThumbnailVideos(attemptIds),
  ]);

  /**
   * The running total for this link. Development only.
   *
   * Summed over the attempts that were actually metered — the rest contribute
   * nothing and are counted separately, rather than being folded in as zero
   * and quietly dragging the total down.
   */
  const metered = attempts.filter((a) => wasMetered(a));
  const devCostTotal =
    env.NODE_ENV === "development"
      ? {
          total: formatInr(
            metered.reduce(
              (sum, a) => sum + interviewCostInr(a, env.AI_PROVIDER),
              0,
            ),
          ),
          metered: metered.length,
          unmetered: attempts.length - metered.length,
        }
      : null;

  return {
    id: interview.id,
    title: interview.title,
    description: interview.description,
    questionCount: interview.questionCount,
    publicToken: interview.publicToken,
    isOpen: interview.isOpen,
    createdAt: interview.createdAt,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      candidateName: attempt.candidateName,
      candidateEmail: attempt.candidateEmail,
      candidatePhone: attempt.candidatePhone,
      status: attempt.status,
      language: attempt.language,
      thumbnailVideoId: thumbnailByAttempt.get(attempt.id) ?? null,
      spokenLanguages: spokenByAttempt.get(attempt.id) ?? [],
      overallScore: attempt.overallScore,
      awayCount: attempt.awayCount,
      // Development only — see `~/config/pricing`. The check is here rather
      // than in the component so the rate card never reaches the browser.
      // Null in production, and null when this interview ran before the
      // counters covered it — see `wasMetered`.
      devCost:
        env.NODE_ENV === "development" && wasMetered(attempt)
          ? formatInr(interviewCostInr(attempt, env.AI_PROVIDER))
          : null,
      createdAt: attempt.createdAt,
    })),
    devCostTotal,
  };
}

/** The first recorded answer clip per attempt, for the card thumbnail. */
async function getThumbnailVideos(
  attemptIds: string[],
): Promise<Map<string, string>> {
  const byAttempt = new Map<string, string>();
  if (attemptIds.length === 0) return byAttempt;

  const rows = await db
    .select({
      attemptId: interviewTurnsTable.attemptId,
      answerVideoId: interviewTurnsTable.answerVideoId,
    })
    .from(interviewTurnsTable)
    .where(
      and(
        inArray(interviewTurnsTable.attemptId, attemptIds),
        isNotNull(interviewTurnsTable.answerVideoId),
      ),
    )
    .orderBy(asc(interviewTurnsTable.turnNumber));

  // Ordered by turn, so the first row seen for an attempt is its earliest clip.
  for (const row of rows) {
    if (row.answerVideoId && !byAttempt.has(row.attemptId)) {
      byAttempt.set(row.attemptId, row.answerVideoId);
    }
  }
  return byAttempt;
}

/**
 * Languages heard per attempt, for a whole list of them at once.
 *
 * Aggregated in the database rather than by loading every turn: a list of
 * fifty candidates would otherwise pull several hundred rows of questions,
 * transcripts and scores to count a single column.
 */
async function getSpokenLanguages(
  attemptIds: string[],
): Promise<Map<string, SpokenLanguage[]>> {
  const byAttempt = new Map<string, SpokenLanguage[]>();
  if (attemptIds.length === 0) return byAttempt;

  const rows = await db
    .select({
      attemptId: interviewTurnsTable.attemptId,
      code: interviewTurnsTable.detectedLanguageCode,
      turns: sql<number>`count(*)::int`,
    })
    .from(interviewTurnsTable)
    .where(
      and(
        inArray(interviewTurnsTable.attemptId, attemptIds),
        isNotNull(interviewTurnsTable.detectedLanguageCode),
      ),
    )
    .groupBy(
      interviewTurnsTable.attemptId,
      interviewTurnsTable.detectedLanguageCode,
    )
    .orderBy(desc(sql`count(*)`));

  for (const row of rows) {
    if (!row.code) continue;
    const list = byAttempt.get(row.attemptId) ?? [];
    list.push({
      code: row.code,
      label: labelForCode(row.code),
      turns: row.turns,
    });
    byAttempt.set(row.attemptId, list);
  }
  return byAttempt;
}

/**
 * Recorded length per media id, for labelling clips in a report.
 *
 * Absent for anything recorded before the length was captured, which is why
 * the caller treats a missing entry as "no length to show" rather than zero.
 */
export async function getClipDurations(
  attemptId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      id: interviewAudioTable.id,
      durationMs: interviewAudioTable.durationMs,
    })
    .from(interviewAudioTable)
    .where(eq(interviewAudioTable.attemptId, attemptId));

  const durations: Record<string, number> = {};
  for (const row of rows) {
    if (row.durationMs && row.durationMs > 0)
      durations[row.id] = row.durationMs;
  }
  return durations;
}

/**
 * Every candidate across every interview this admin owns.
 *
 * The interview pages answer "how is this interview going"; this answers
 * "who has been assessed", which is the question you have when you are
 * looking for one person rather than one interview.
 *
 * Spoken languages come from the same aggregate the dialog uses, so a row
 * reads identically in both places.
 */
export interface ReportRow {
  attemptId: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  status: string;
  overallScore: number | null;
  awayCount: number;
  language: string | null;
  spokenLanguages: SpokenLanguage[];
  interviewId: string;
  interviewTitle: string;
  createdAt: Date;
  completedAt: Date | null;
}

export async function listReports(adminId: string): Promise<ReportRow[]> {
  const rows = await db
    .select({
      attemptId: interviewAttemptsTable.id,
      candidateName: interviewAttemptsTable.candidateName,
      candidateEmail: interviewAttemptsTable.candidateEmail,
      candidatePhone: interviewAttemptsTable.candidatePhone,
      status: interviewAttemptsTable.status,
      overallScore: interviewAttemptsTable.overallScore,
      awayCount: interviewAttemptsTable.awayCount,
      language: interviewAttemptsTable.language,
      interviewId: interviewsTable.id,
      interviewTitle: interviewsTable.title,
      createdAt: interviewAttemptsTable.createdAt,
      completedAt: interviewAttemptsTable.completedAt,
    })
    .from(interviewAttemptsTable)
    .innerJoin(
      interviewsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(eq(interviewsTable.createdByUserId, adminId))
    .orderBy(desc(interviewAttemptsTable.createdAt))
    .limit(500);

  const spoken = await getSpokenLanguages(rows.map((r) => r.attemptId));

  return rows.map((row) => ({
    ...row,
    spokenLanguages: spoken.get(row.attemptId) ?? [],
  }));
}

/* -------------------------------------------------------------------------- */
/*                          Development-only helpers                          */
/* -------------------------------------------------------------------------- */

/**
 * Delete one attempt outright — recordings, turns, scores, everything.
 *
 * Development only, and deliberately so. Testing the interview flow leaves a
 * long tail of half-finished attempts that make the candidate grid unreadable,
 * and there is no sound product reason to let an admin destroy a real
 * candidate's assessment from a hover button: a completed interview is
 * evidence about a person, and the wrong click would be unrecoverable.
 *
 * The stored objects go first. The database rows cascade from the attempt, so
 * deleting that first would strip the storage keys out from under us and leave
 * the video sitting in the bucket with nothing pointing at it.
 */
export async function deleteAttemptInDev(
  adminId: string,
  attemptId: string,
): Promise<void> {
  if (env.NODE_ENV !== "development") {
    throw new Error("Attempts can only be deleted in development.");
  }

  // Scoped to interviews this admin owns, exactly like every other read here.
  const attempt = await db
    .select({ id: interviewAttemptsTable.id })
    .from(interviewAttemptsTable)
    .innerJoin(
      interviewsTable,
      eq(interviewsTable.id, interviewAttemptsTable.interviewId),
    )
    .where(
      and(
        eq(interviewAttemptsTable.id, attemptId),
        eq(interviewsTable.createdByUserId, adminId),
      ),
    )
    .limit(1);
  if (attempt.length === 0) return;

  const clips = await db
    .select({ storageKey: interviewAudioTable.storageKey })
    .from(interviewAudioTable)
    .where(eq(interviewAudioTable.attemptId, attemptId));

  await Promise.all(
    clips.map((clip) =>
      deleteAudioObject(clip.storageKey).catch(() => undefined),
    ),
  );

  await db
    .delete(interviewAttemptsTable)
    .where(eq(interviewAttemptsTable.id, attemptId));
}
