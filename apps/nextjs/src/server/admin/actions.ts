"use server";

import { revalidatePath } from "next/cache";

import {
  createGeneralInterview,
  deleteAttempt,
  getAttemptForAdmin,
  requireAdmin,
  setInterviewOpen,
} from "./service";
import { rescoreAttempt, resendResult } from "~/server/attempt/service";
import {
  cancelRescore,
  failedIdsOf,
  progressOf,
  startRescoreAll,
  type RescoreProgress,
  type RescoreScope,
} from "~/server/attempt/rescore-job";
import { env } from "~/env";
import { db } from "~/server/db";
import { interviewsTable } from "~/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { CreateInterviewResult } from "./dto";

/**
 * Create an interview.
 *
 * There is nothing to configure: every interview covers the same workplace
 * skills, picks up the candidate's language from how they answer, and decides
 * follow-ups from each answer — so a form has nothing to collect. The caller
 * opens the new interview's dialog with the returned id.
 *
 * `requireAdmin` runs first on every admin action, not just the pages — a
 * server action is a public endpoint and must carry its own authorization.
 */
export async function createInterviewAction(): Promise<CreateInterviewResult> {
  const admin = await requireAdmin("/admin");

  try {
    const interview = await createGeneralInterview(admin.id);
    revalidatePath("/admin");
    revalidatePath("/admin/interviews");
    return { ok: true, interviewId: interview.id };
  } catch (error) {
    console.error("[admin] create interview failed", error);
    return {
      ok: false,
      error: "The interview could not be created. Please try again.",
    };
  }
}

export async function setInterviewOpenAction(
  interviewId: string,
  isOpen: boolean,
): Promise<void> {
  const admin = await requireAdmin("/admin");
  await setInterviewOpen(admin.id, interviewId, isOpen);
  revalidatePath("/admin/interviews");
  revalidatePath("/admin");
}

/**
 * Re-grade a finished report from its stored transcripts (e.g. after a scoring
 * change). No re-recording or speech APIs — just re-scoring + a fresh summary.
 */
export async function rescoreAttemptAction(
  attemptId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("/admin");

  // Confirm this admin owns the attempt before touching its scores.
  const found = await getAttemptForAdmin(admin.id, attemptId);
  if (!found) return { ok: false, error: "That report could not be found." };

  try {
    await rescoreAttempt(attemptId);
    revalidatePath(`/admin/attempts/${attemptId}`);
    return { ok: true };
  } catch (error) {
    console.error("[admin] rescore failed", error);
    return {
      ok: false,
      error: "Could not re-score this report. Please try again.",
    };
  }
}

/**
 * Re-send a finished result to the partner webhook (integration candidates only).
 * For results that never reached the partner — the webhook was configured after
 * the interview, or an earlier delivery failed.
 */
export async function resendResultAction(
  attemptId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("/admin");

  const found = await getAttemptForAdmin(admin.id, attemptId);
  if (!found) return { ok: false, error: "That report could not be found." };

  try {
    const result = await resendResult(attemptId);
    if (!result.ok) return { ok: false, error: result.reason };
    revalidatePath(`/admin/attempts/${attemptId}`);
    return { ok: true };
  } catch (error) {
    console.error("[admin] resend result failed", error);
    return {
      ok: false,
      error: "Could not resend the result. Please try again.",
    };
  }
}

/**
 * Delete one candidate's attempt. DEVELOPMENT ONLY.
 *
 * Clears test runs out of the grid while building. `deleteAttempt` enforces
 * both the environment and the ownership check itself — this is a public
 * endpoint, so neither can live only in the button that calls it.
 */
export async function deleteAttemptAction(
  attemptId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin("/admin");

  try {
    await deleteAttempt(admin.id, attemptId);
  } catch (error) {
    console.error("[admin] delete attempt failed", error);
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not delete this attempt.",
    };
  }

  // The grid it vanished from, and the report page that no longer exists.
  revalidatePath("/admin");
  return { ok: true };
}

/** Their own interview, or nothing. */
async function ownsInterview(
  adminId: string,
  interviewId: string,
): Promise<boolean> {
  const row = await db.query.interviewsTable.findFirst({
    columns: { id: true },
    where: and(
      eq(interviewsTable.id, interviewId),
      eq(interviewsTable.createdByUserId, adminId),
    ),
  });
  return row !== undefined;
}

/**
 * Re-grade every completed attempt under one interview. DEVELOPMENT ONLY.
 *
 * Returns as soon as the job is running, never when it has finished — several
 * hundred attempts is hours of model calls, and no request survives that.
 * Poll `rescoreAllProgressAction` for where it is.
 */
export async function rescoreAllAction(
  interviewId: string,
  /**
   * What to work through.
   *
   * "remaining" skips attempts already re-scored, read from the database, so
   * a run interrupted by a restart picks up where it stopped instead of
   * starting the whole interview again. "retry" re-runs only what the last
   * run could not finish, which lives in memory and does not survive one.
   */
  mode: "remaining" | "all" | "retry" = "remaining",
): Promise<{ ok: boolean; error?: string; progress?: RescoreProgress }> {
  const admin = await requireAdmin("/admin");

  if (env.NODE_ENV !== "development") {
    return { ok: false, error: "Bulk re-scoring is a development-only tool." };
  }
  if (!(await ownsInterview(admin.id, interviewId))) {
    return { ok: false, error: "That interview could not be found." };
  }

  let scope: RescoreScope;
  if (mode === "retry") {
    const ids = failedIdsOf(interviewId);
    if (ids.length === 0) return { ok: false, error: "Nothing left to retry." };
    scope = { kind: "ids", ids };
  } else {
    scope = { kind: mode };
  }

  const progress = startRescoreAll(interviewId, scope);
  return progress
    ? { ok: true, progress }
    : { ok: false, error: "Could not start the re-score." };
}

/**
 * Stop a running bulk re-score. DEVELOPMENT ONLY.
 *
 * Everything already re-scored keeps its new scores; the rest are left
 * exactly as they were. See `cancelRescore` for why the attempts already in
 * flight are allowed to finish.
 */
export async function cancelRescoreAllAction(
  interviewId: string,
): Promise<{ ok: boolean; progress?: RescoreProgress }> {
  const admin = await requireAdmin("/admin");
  if (env.NODE_ENV !== "development") return { ok: false };
  if (!(await ownsInterview(admin.id, interviewId))) return { ok: false };
  return { ok: true, progress: cancelRescore(interviewId) ?? undefined };
}

/** Where the bulk re-score has got to. Development only. */
export async function rescoreAllProgressAction(
  interviewId: string,
): Promise<RescoreProgress | null> {
  const admin = await requireAdmin("/admin");
  if (env.NODE_ENV !== "development") return null;
  if (!(await ownsInterview(admin.id, interviewId))) return null;
  return progressOf(interviewId);
}
