import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { User } from "lucia";

import { db } from "~/server/db";
import {
  interviewAttemptsTable,
  interviewAudioTable,
  interviewTurnsTable,
  interviewsTable,
  usersTable,
} from "~/server/db/schema";
import type {
  Interview,
  InterviewAttempt,
  InterviewTurn,
} from "~/server/db/schema";
import { aggregateSkillScores } from "~/lib/scoring";
import { WORK_SKILLS } from "~/config/work-skills";
import type { WorkSkillId } from "~/config/work-skills";
import type { InterviewDetails } from "./dto";
import { formatInr, interviewCost, wasMetered } from "~/config/pricing";
import { env } from "~/env";
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
  },
): Promise<Interview> {
  const [row] = await db
    .insert(interviewsTable)
    .values({
      createdByUserId: adminId,
      title: input.title,
      description: input.description,
      questionCount: input.questionCount ?? DEFAULT_QUESTION_COUNT,
      // followUpSkills column is unused now (follow-ups are answer-driven on
      // every skill); the DB default [] fills it.
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
 * Every interview is the same workplace skills, and the language comes
 * from how the candidate answers, so there is no configuration to collect.
 * The title exists only so an admin can tell two links apart and is numbered
 * from how many they already have. Two simultaneous creates can land on the
 * same number — nothing depends on it being unique, and the share token is
 * what actually identifies an interview.
 */
export async function createGeneralInterview(
  adminId: string,
): Promise<Interview> {
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(interviewsTable)
    .where(eq(interviewsTable.createdByUserId, adminId));

  return createInterview(adminId, {
    title: `General interview ${(counted?.total ?? 0) + 1}`,
    description: null,
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
    // High cap, not 500: a candidate can now RETAKE (up to 3 attempts), so rows
    // far outnumber people. A 500 cap ordered by newest silently dropped older
    // COMPLETED attempts out of the window as fresh in-progress ones arrived —
    // which is exactly why the completed count appeared to shrink. Load enough
    // that the per-candidate collapse below sees every attempt.
    // ponytail: fine to a few thousand candidates; page + aggregate if it grows.
    limit: 5000,
  });

  return { interview, attempts };
}

/** Rank a status so a candidate's "best" attempt wins the collapse below. */
const ATTEMPT_STATUS_RANK: Record<string, number> = {
  completed: 5,
  processing: 4,
  in_progress: 3,
  failed: 2,
  not_started: 1,
};

/** How a candidate is identified across their retakes. */
function candidateKey(a: InterviewAttempt): string {
  return (
    a.externalStudentId?.trim() ||
    a.candidateEmail?.trim().toLowerCase() ||
    a.id
  );
}

/**
 * Collapse an interview's attempts to ONE per candidate.
 *
 * With retakes, one person has several attempts, which double-counted them
 * (shown in both "in progress" and "completed") and made "completed" jitter.
 * Keep each candidate's BEST attempt — completed beats in-progress beats
 * not-started, newest breaks ties — so counts are per-person and, once someone
 * has finished, they stay "completed" even while a retake is under way.
 */
function collapseByCandidate(attempts: InterviewAttempt[]): InterviewAttempt[] {
  const best = new Map<string, InterviewAttempt>();
  for (const a of attempts) {
    const key = candidateKey(a);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, a);
      continue;
    }
    const rank = ATTEMPT_STATUS_RANK[a.status] ?? 0;
    const curRank = ATTEMPT_STATUS_RANK[cur.status] ?? 0;
    if (rank > curRank || (rank === curRank && a.createdAt > cur.createdAt)) {
      best.set(key, a);
    }
  }
  return [...best.values()];
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

export interface AttemptTab {
  attemptId: string;
  /** 1-based, oldest first. */
  attemptNumber: number;
  status: string;
  overallScore: number | null;
  createdAt: Date;
  completedAt: Date | null;
  isCurrent: boolean;
}

/** One skill's score across every attempt, aligned to `attempts` order. */
export interface SkillComparisonRow {
  skillId: WorkSkillId;
  label: string;
  /** 0-10 per attempt (same order as `attempts`), null where not assessed. */
  scores: (number | null)[];
}

export interface CandidateAttempts {
  attempts: AttemptTab[];
  /** Per-skill score matrix for the side-by-side comparison. */
  skills: SkillComparisonRow[];
}

/**
 * A candidate's attempts at the SAME interview, oldest first — for the report's
 * tab bar AND the side-by-side score comparison. Identity is the partner student
 * id when present, else email (the same key retakes are counted by). Scoped to
 * the admin's own interview. Returns null when there is only one attempt (no
 * tabs, no comparison needed).
 */
export async function getCandidateAttempts(
  adminId: string,
  attempt: InterviewAttempt,
): Promise<CandidateAttempts | null> {
  const studentId = attempt.externalStudentId?.trim() || null;
  const email = attempt.candidateEmail?.trim() || null;
  if (!studentId && !email) return null;

  const identity = studentId
    ? eq(interviewAttemptsTable.externalStudentId, studentId)
    : eq(interviewAttemptsTable.candidateEmail, email!);

  const rows = await db
    .select({
      attemptId: interviewAttemptsTable.id,
      status: interviewAttemptsTable.status,
      overallScore: interviewAttemptsTable.overallScore,
      createdAt: interviewAttemptsTable.createdAt,
      completedAt: interviewAttemptsTable.completedAt,
    })
    .from(interviewAttemptsTable)
    .innerJoin(
      interviewsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(
      and(
        eq(interviewAttemptsTable.interviewId, attempt.interviewId),
        identity,
        eq(interviewsTable.createdByUserId, adminId),
      ),
    )
    .orderBy(asc(interviewAttemptsTable.createdAt));

  if (rows.length <= 1) return null;

  const attempts: AttemptTab[] = rows.map((r, i) => ({
    ...r,
    attemptNumber: i + 1,
    isCurrent: r.attemptId === attempt.id,
  }));

  // Per-attempt per-skill scores, using the SAME aggregation the report uses so
  // the comparison matches each attempt's own report exactly.
  const ids = attempts.map((a) => a.attemptId);
  const turns = await db.query.interviewTurnsTable.findMany({
    where: inArray(interviewTurnsTable.attemptId, ids),
  });
  const turnsByAttempt = new Map<string, InterviewTurn[]>();
  for (const t of turns) {
    const list = turnsByAttempt.get(t.attemptId) ?? [];
    list.push(t);
    turnsByAttempt.set(t.attemptId, list);
  }
  const scoreByAttempt = new Map<string, Map<WorkSkillId, number | null>>();
  for (const id of ids) {
    const agg = aggregateSkillScores(turnsByAttempt.get(id) ?? []);
    scoreByAttempt.set(id, new Map(agg.map((s) => [s.skillId, s.score])));
  }

  const skills: SkillComparisonRow[] = WORK_SKILLS.map((skill) => ({
    skillId: skill.id,
    label: skill.label,
    scores: ids.map((id) => scoreByAttempt.get(id)?.get(skill.id) ?? null),
  }));

  return { attempts, skills };
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

  const { interview } = found;
  // One card + one count per candidate, not per attempt (retakes make several).
  const attempts = collapseByCandidate(found.attempts);
  const attemptIds = attempts.map((a) => a.id);
  const isDev = env.NODE_ENV === "development";
  const [
    spokenByAttempt,
    thumbnailByAttempt,
    sttMinutesByAttempt,
    questionCharsByAttempt,
  ] = await Promise.all([
    getSpokenLanguages(attemptIds),
    getThumbnailVideos(attemptIds),
    // Only in development, and only because the cost badge needs it — these
    // are extra aggregates over every clip and turn in the interview.
    isDev ? getSttMinutes(attemptIds) : Promise.resolve(new Map()),
    isDev ? getQuestionChars(attemptIds) : Promise.resolve(new Map()),
  ]);

  /**
   * The running total for this link, split by provider. Development only.
   *
   * Summed over the attempts the meter actually covered; the rest are counted
   * separately rather than folded in as zero, because a total over four runs
   * out of seven is a different claim from a total over all seven.
   */
  /** One place both the per-card badge and the header total cost from. */
  const costOf = (a: (typeof attempts)[number]) =>
    interviewCost(
      {
        sttMinutes: sttMinutesByAttempt.get(a.id) ?? 0,
        ttsCharacters: a.ttsCharacters,
        llmInputTokens: a.llmInputTokens,
        llmOutputTokens: a.llmOutputTokens,
      },
      env.AI_PROVIDER,
    );

  /**
   * The least this interview can have cost, for one the meter never saw.
   *
   * Speech can be priced exactly after the fact: the question text is stored
   * and this branch synthesises one clip per question, so the characters are
   * known, and the answers carry their own measured durations. Only the model
   * tokens are unrecoverable — and they are the larger share, so this is a
   * floor and is labelled as one rather than passed off as the total.
   */
  const floorOf = (a: (typeof attempts)[number]) =>
    interviewCost(
      {
        sttMinutes: sttMinutesByAttempt.get(a.id) ?? 0,
        ttsCharacters: questionCharsByAttempt.get(a.id) ?? 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
      },
      env.AI_PROVIDER,
    );

  /** Whoever is running the brain today. See `AI_PROVIDER`. */
  const modelLabel = env.AI_PROVIDER === "sarvam" ? "Sarvam" : "OpenAI";

  /** Metered where we can, floored where we cannot, and which is which. */
  const readingFor = (a: (typeof attempts)[number]) => {
    if (!isDev) return { cost: undefined, parts: undefined, floor: undefined };
    const metered = wasMetered(a);
    const c = metered ? costOf(a) : floorOf(a);
    if (!metered && c.total === 0) {
      return { cost: null, parts: null, floor: undefined };
    }
    return {
      cost: formatInr(c.total),
      parts: `${modelLabel} ${formatInr(c.llm)} · TTS ${formatInr(
        c.tts,
      )} · STT ${formatInr(c.stt)}`,
      floor: metered ? undefined : true,
    };
  };

  const metered = isDev ? attempts.filter((a) => wasMetered(a)) : [];
  const devCosts = isDev
    ? (() => {
        const sum = attempts.reduce(
          (acc, a) => {
            const c = wasMetered(a) ? costOf(a) : floorOf(a);
            return {
              llm: acc.llm + c.llm,
              tts: acc.tts + c.tts,
              stt: acc.stt + c.stt,
              total: acc.total + c.total,
            };
          },
          { llm: 0, tts: 0, stt: 0, total: 0 },
        );
        return {
          // Named by whichever provider is actually running the brain — the
          // label used to say OpenAI whatever `AI_PROVIDER` was set to, which
          // meant it read "OpenAI" while quoting Sarvam's rates.
          modelLabel: env.AI_PROVIDER === "sarvam" ? "Sarvam" : "OpenAI",
          openai: formatInr(sum.llm),
          tts: formatInr(sum.tts),
          stt: formatInr(sum.stt),
          total: formatInr(sum.total),
          metered: metered.length,
          unmetered: attempts.length - metered.length,
          // True when any part of the total came from a floor, so the header
          // can say "at least" rather than state it as the bill.
          hasFloor: metered.length < attempts.length,
        };
      })()
    : undefined;

  return {
    id: interview.id,
    title: interview.title,
    description: interview.description,
    questionCount: interview.questionCount,
    publicToken: interview.publicToken,
    isOpen: interview.isOpen,
    createdAt: interview.createdAt,
    devCosts,
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
      // Null in production, and null when the meter did not cover this
      // interview — see `wasMetered`. A zero would be a claim that it was free.
      devCost: readingFor(attempt).cost,
      devCostParts: readingFor(attempt).parts,
      devCostIsFloor: readingFor(attempt).floor,
      createdAt: attempt.createdAt,
    })),
  };
}

/**
 * Minutes of candidate audio per attempt, for the development cost badge.
 *
 * Read from recordings rather than a counter, because Sarvam bills
 * speech-to-text per second of audio and the streaming path never makes a
 * countable request — it holds a socket open, so there is nothing to increment.
 *
 * The VIDEO is the source, not the audio clip. Since realtime streaming
 * replaced batch transcription, answer audio is no longer archived at all —
 * recent interviews have zero `answer` rows — while the webcam recording still
 * runs for every answer on every path and carries a measured duration. It also
 * happens to be the better match: the socket streams for as long as the
 * candidate has the microphone, which is the length of the recording.
 *
 * The `answer` clips remain as a fallback so interviews from the batch era
 * still price correctly. Whichever source is used, only one is counted, so a
 * turn that produced both cannot be billed twice.
 */
async function getSttMinutes(
  attemptIds: string[],
): Promise<Map<string, number>> {
  const byAttempt = new Map<string, number>();
  if (attemptIds.length === 0) return byAttempt;

  const rows = await db
    .select({
      attemptId: interviewAudioTable.attemptId,
      kind: interviewAudioTable.kind,
      ms: sql<number>`coalesce(sum(${interviewAudioTable.durationMs}), 0)::int`,
    })
    .from(interviewAudioTable)
    .where(
      and(
        inArray(interviewAudioTable.attemptId, attemptIds),
        inArray(interviewAudioTable.kind, ["answer_video", "answer"]),
      ),
    )
    .groupBy(interviewAudioTable.attemptId, interviewAudioTable.kind);

  // Video first; audio only where an attempt has no video at all.
  const video = new Map<string, number>();
  const audio = new Map<string, number>();
  for (const row of rows) {
    (row.kind === "answer_video" ? video : audio).set(row.attemptId, row.ms);
  }
  for (const id of attemptIds) {
    const ms = video.get(id) ?? audio.get(id) ?? 0;
    if (ms > 0) byAttempt.set(id, ms / 60000);
  }
  return byAttempt;
}

/**
 * Characters of question text per attempt, for costing interviews the meter
 * never saw.
 *
 * Sound only because this branch synthesises exactly one clip per question —
 * verified against stored clips. On older data, where fixed lines were voiced
 * per attempt, this understates what was actually spoken, which is why every
 * figure derived from it is presented as a floor.
 */
async function getQuestionChars(
  attemptIds: string[],
): Promise<Map<string, number>> {
  const byAttempt = new Map<string, number>();
  if (attemptIds.length === 0) return byAttempt;

  const rows = await db
    .select({
      attemptId: interviewTurnsTable.attemptId,
      chars: sql<number>`coalesce(sum(length(${interviewTurnsTable.question})), 0)::int`,
    })
    .from(interviewTurnsTable)
    .where(inArray(interviewTurnsTable.attemptId, attemptIds))
    .groupBy(interviewTurnsTable.attemptId);

  for (const row of rows) byAttempt.set(row.attemptId, row.chars);
  return byAttempt;
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
