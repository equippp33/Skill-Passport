"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  attemptEligibility,
  getAttemptForCandidate,
  getInterviewByPublicToken,
  MAX_ATTEMPTS_PER_CANDIDATE,
  resumableAttemptFor,
  setAttemptCookie,
} from "./access";
import { candidateDetailsSchema } from "~/server/interview/validation";
import type { InterviewLanguageKey } from "~/config/languages";
import {
  createAttempt,
  prewarmFirstQuestion,
  regenerateQuestionAudio,
  skipTurn,
  startAttempt,
} from "./service";

export interface CandidateFormState {
  error: string | null;
  fieldErrors?: Record<string, string>;
}

/**
 * Candidate starts an attempt from a shared link.
 *
 * The interview is looked up by its public token — never by a database id —
 * and each submission creates a fresh attempt, so any number of candidates
 * can use the same link without seeing each other.
 */
export async function beginAttemptAction(
  publicToken: string,
  _prev: CandidateFormState,
  formData: FormData,
): Promise<CandidateFormState> {
  const interview = await getInterviewByPublicToken(publicToken);
  if (!interview) {
    return { error: "This interview link is not valid or has been closed." };
  }

  const parsed = candidateDetailsSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    language: formData.get("language"),
    course: formData.get("course"),
    studentId: formData.get("studentId"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { error: null, fieldErrors };
  }

  // Resume before anything else: if this candidate has an unfinished attempt,
  // take them back INTO it rather than starting fresh. Matched on identity, so it
  // works even without the cookie (new device / cleared cookies). Outranks the
  // retake cap — an unfinished run is not a new retry. `redirect` throws, so it
  // must stay outside any try/catch.
  const resumable = await resumableAttemptFor(interview.id, {
    externalStudentId: parsed.data.studentId,
    email: parsed.data.email,
  });
  if (resumable) {
    await setAttemptCookie(resumable.accessToken);
    redirect(`/attempt/${resumable.id}`);
  }

  // Retake limits: at most a few attempts per candidate, with a cooldown after
  // each finished one. Checked here (identity is known from the form) so it holds
  // for ordinary and integration links alike.
  const eligibility = await attemptEligibility(interview.id, {
    externalStudentId: parsed.data.studentId,
    email: parsed.data.email,
  });
  if (!eligibility.allowed) {
    if (eligibility.reason === "cooldown") {
      const minutes = eligibility.readyInMinutes ?? 1;
      return {
        error: `You just finished an attempt. Please wait about ${minutes} minute${
          minutes === 1 ? "" : "s"
        } before retaking this interview.`,
      };
    }
    return {
      error: `You've used all ${MAX_ATTEMPTS_PER_CANDIDATE} attempts for this interview.`,
    };
  }

  const { attemptId, accessToken } = await createAttempt(interview, {
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    language: parsed.data.language as InterviewLanguageKey,
    course: parsed.data.course,
    externalStudentId: parsed.data.studentId,
  });

  // The only time this token leaves the server. From here on the cookie is
  // what proves the candidate owns this attempt.
  await setAttemptCookie(accessToken);
  redirect(`/attempt/${attemptId}`);
}

/**
 * Fire-and-forget: prepare the first question while the candidate reads the
 * instructions / tests their device, so the interview starts with no wait.
 */
export async function prewarmAttemptAction(attemptId: string): Promise<void> {
  const found = await getAttemptForCandidate(attemptId);
  if (!found) return;
  try {
    await prewarmFirstQuestion(found.attempt, found.interview);
  } catch (error) {
    console.error("[attempt] prewarm action failed", error);
  }
}

export async function startAttemptAction(
  attemptId: string,
): Promise<{ ok: boolean; error?: string }> {
  const found = await getAttemptForCandidate(attemptId);
  if (!found) return { ok: false, error: "Your session has expired." };

  try {
    await startAttempt(found.attempt.id);
    revalidatePath(`/attempt/${attemptId}`);
    return { ok: true };
  } catch (error) {
    console.error("[attempt] start failed", error);
    return { ok: false, error: "Could not start the interview." };
  }
}

/** Candidate tapped "skip" — move past the current question, unscored. */
export async function skipTurnAction(
  attemptId: string,
  turnNumber: number,
): Promise<{ ok: boolean }> {
  const found = await getAttemptForCandidate(attemptId);
  if (!found) return { ok: false };

  try {
    await skipTurn(found.attempt, found.interview, turnNumber);
    revalidatePath(`/attempt/${attemptId}`);
    return { ok: true };
  } catch (error) {
    console.error("[attempt] skip failed", error);
    return { ok: false };
  }
}

export async function retryQuestionAudioAction(
  attemptId: string,
  turnNumber: number,
): Promise<{ ok: boolean }> {
  const found = await getAttemptForCandidate(attemptId);
  if (!found) return { ok: false };

  try {
    const ok = await regenerateQuestionAudio(found.attempt, turnNumber);
    return { ok };
  } catch {
    return { ok: false };
  }
}
