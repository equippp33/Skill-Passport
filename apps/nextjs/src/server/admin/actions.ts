"use server";

import { revalidatePath } from "next/cache";

import {
  createGeneralInterview,
  getAttemptForAdmin,
  requireAdmin,
  setInterviewOpen,
} from "./service";
import { rescoreAttempt } from "~/server/attempt/service";
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
