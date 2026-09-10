"use server";

import { revalidatePath } from "next/cache";

import {
  createGeneralInterview,
  requireAdmin,
  setInterviewOpen,
} from "./service";
import type { CreateInterviewResult } from "./dto";

/**
 * Create an interview.
 *
 * There is nothing to configure: every interview covers the same ten
 * workplace skills and picks up the candidate's language from how they
 * answer, so the only input a form could collect would be a name — and one
 * is generated. The caller opens the new interview's dialog with the
 * returned id.
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
