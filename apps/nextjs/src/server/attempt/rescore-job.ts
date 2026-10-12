import "server-only";

import { and, asc, eq, inArray, notExists } from "drizzle-orm";

import { db } from "~/server/db";
import {
  attemptScoreSnapshotsTable,
  interviewAttemptsTable,
} from "~/server/db/schema";
import { pool } from "~/lib/pool";
import { rescoreAttempt } from "./service";

/**
 * Re-score every completed attempt under one interview. DEVELOPMENT ONLY.
 *
 * A scoring change is worthless on history until the history is re-graded,
 * and doing that a candidate at a time through the UI is not realistic at the
 * sizes these links reach — one of them has 506 completed attempts.
 *
 * This CANNOT be a request. Re-scoring one attempt is a model call per
 * answer; several hundred of them runs for a long time, far past any request
 * timeout. So the action starts the job and returns immediately, the job runs
 * in the server process, and the page polls `progressOf` to show where it got
 * to.
 *
 * The consequence of living in process memory is worth stating plainly: a
 * restart loses the job. Progress stops moving, nothing marks it failed, and
 * the attempts already re-scored keep their new scores. Starting it again
 * simply does the whole interview over, which is wasteful but never wrong —
 * re-scoring always derives from the stored transcripts rather than from the
 * previous score.
 */

export interface RescoreProgress {
  total: number;
  done: number;
  failed: number;
  running: boolean;
  /** Set when somebody stopped it; the remaining attempts are left untouched. */
  cancelled: boolean;
  startedAt: number;
  /** Seconds left at the rate achieved so far; null until one has finished. */
  etaSeconds: number | null;
  /** How many attempts the last run could not finish, available to retry. */
  retryable: number;
}

/**
 * How many attempts are re-scored at once.
 *
 * Each one is already internally parallel (`RESCORE_CONCURRENCY`, four
 * answers at a time), so this multiplies out to sixteen concurrent calls.
 *
 * Sixteen was measured, not guessed: sixteen simultaneous scoring calls
 * against a nineteen-thousand-character prompt came back in 1.7 seconds with
 * no errors. The limit still matters — the provider is shared with candidates
 * sitting in live interviews, and a bulk job that trips the circuit breaker
 * takes the interviews down with it — so this stays well inside what the
 * endpoint demonstrably absorbs rather than hunting for the edge.
 */
const ATTEMPTS_AT_ONCE = 4;

/**
 * Attempts at one candidate before giving up on them.
 *
 * Not for bad data: for the network. A long run reaches across to a remote
 * database thousands of times, and a single `EHOSTUNREACH` — the host briefly
 * unreachable — would otherwise write off a candidate who was never the
 * problem. One retry after a short pause recovers nearly all of those.
 */
const TRIES_PER_ATTEMPT = 2;
const RETRY_PAUSE_MS = 2000;

interface Job {
  progress: RescoreProgress;
  /** Read by the worker between attempts. */
  cancelled: boolean;
  /** Attempts the run could not finish, so they can be retried on their own. */
  failedIds: string[];
}

/**
 * interviewId -> job. One per interview at a time.
 *
 * Cached on `globalThis`, for the same reason the database pool is: Next
 * re-evaluates modules on every hot reload, and a plain module-level Map is
 * replaced with an empty one each time. The job itself keeps running inside
 * the old module instance, so editing any file during a long run would
 * ORPHAN it — still working, still writing scores, but invisible to the page
 * and impossible to cancel. The only way out was to restart the server.
 *
 * Surviving the reload keeps the running job reachable. A full restart still
 * loses it, which is inherent to holding this in memory at all.
 */
const globalForJobs = globalThis as unknown as {
  __skillPassportRescoreJobs?: Map<string, Job>;
};
const jobs: Map<string, Job> =
  globalForJobs.__skillPassportRescoreJobs ?? new Map<string, Job>();
globalForJobs.__skillPassportRescoreJobs = jobs;

export function progressOf(interviewId: string): RescoreProgress | null {
  return jobs.get(interviewId)?.progress ?? null;
}

/**
 * Stop after the attempts already in flight.
 *
 * Deliberately not mid-attempt. A candidate halfway through a re-score has
 * some answers on the new scoring and some on the old, which is a report
 * nobody can interpret; letting the four in flight finish costs seconds and
 * leaves every candidate whole.
 */
export function cancelRescore(interviewId: string): RescoreProgress | null {
  const job = jobs.get(interviewId);
  if (!job?.progress.running) return job?.progress ?? null;
  job.cancelled = true;
  job.progress.cancelled = true;
  return job.progress;
}

/**
 * Begin, unless this interview is already running.
 *
 * `onlyIds` re-runs a specific set — the attempts a previous run could not
 * finish. Returns the progress to show immediately, so the caller never has
 * to guess whether it started.
 */
export type RescoreScope =
  /** Only attempts never re-scored before. Survives a restart; see `run`. */
  | { kind: "remaining" }
  /** Every completed attempt, re-scored again. */
  | { kind: "all" }
  /** Exactly these — what a previous run could not finish. */
  | { kind: "ids"; ids: string[] };

export function startRescoreAll(
  interviewId: string,
  scope: RescoreScope = { kind: "remaining" },
): RescoreProgress | null {
  const existing = jobs.get(interviewId);
  if (existing?.progress.running) return existing.progress;

  const job: Job = {
    progress: {
      total: 0,
      done: 0,
      failed: 0,
      running: true,
      cancelled: false,
      startedAt: Date.now(),
      etaSeconds: null,
      retryable: 0,
    },
    cancelled: false,
    failedIds: [],
  };
  jobs.set(interviewId, job);

  // Deliberately NOT awaited: the caller is a request and must return now.
  void run(interviewId, job, scope);
  return job.progress;
}

/** The attempts a finished run could not complete. */
export function failedIdsOf(interviewId: string): string[] {
  return jobs.get(interviewId)?.failedIds ?? [];
}

async function run(
  interviewId: string,
  job: Job,
  scope: RescoreScope,
): Promise<void> {
  const { progress } = job;
  try {
    /**
     * "Remaining" is read from the DATABASE, not from what this process
     * remembers.
     *
     * Re-scoring writes a snapshot of the previous report before it replaces
     * it, so an attempt that has one has already been through this. That
     * makes the work resumable across a restart, which matters a great deal
     * here: losing a run halfway used to mean re-doing all five hundred
     * candidates from the start, hours of model calls to arrive back where it
     * already was.
     *
     * It also means a LATER scoring change needs the explicit "all" scope,
     * because by then every attempt has a snapshot and nothing looks
     * remaining.
     */
    const neverRescored = notExists(
      db
        .select({ one: attemptScoreSnapshotsTable.id })
        .from(attemptScoreSnapshotsTable)
        .where(eq(attemptScoreSnapshotsTable.attemptId, interviewAttemptsTable.id)),
    );

    const attempts = await db
      .select({ id: interviewAttemptsTable.id })
      .from(interviewAttemptsTable)
      .where(
        and(
          eq(interviewAttemptsTable.interviewId, interviewId),
          eq(interviewAttemptsTable.status, "completed"),
          ...(scope.kind === "remaining" ? [neverRescored] : []),
          ...(scope.kind === "ids" && scope.ids.length > 0
            ? [inArray(interviewAttemptsTable.id, scope.ids)]
            : []),
        ),
      )
      .orderBy(asc(interviewAttemptsTable.completedAt));

    progress.total = attempts.length;

    await pool(attempts, ATTEMPTS_AT_ONCE, async (attempt) => {
      // Checked here rather than inside the attempt: see `cancelRescore`.
      if (job.cancelled) return;

      for (let tries = 1; ; tries += 1) {
        try {
          await rescoreAttempt(attempt.id);
          break;
        } catch (error) {
          if (tries >= TRIES_PER_ATTEMPT || job.cancelled) {
            progress.failed += 1;
            job.failedIds.push(attempt.id);
            console.error(
              `[rescore-all] gave up on ${attempt.id} after ${tries}:`,
              error,
            );
            break;
          }
          await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
        }
      }

      progress.done += 1;
      // Measured from what has actually happened rather than assumed: a
      // candidate who answered three questions re-scores in a fraction of the
      // time one who answered thirteen does, so a fixed per-attempt figure
      // would be wrong in both directions.
      const elapsed = (Date.now() - progress.startedAt) / 1000;
      const rate = progress.done / elapsed;
      progress.etaSeconds =
        rate > 0 ? Math.round((progress.total - progress.done) / rate) : null;
    });
  } catch (error) {
    console.error("[rescore-all] job aborted:", error);
  } finally {
    progress.running = false;
    progress.etaSeconds = null;
    progress.retryable = job.failedIds.length;
  }
}
