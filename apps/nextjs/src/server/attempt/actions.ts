"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getAttemptForCandidate,
  getInterviewByPublicToken,
  setAttemptCookie,
} from "./access";
import {
  chooseLanguage,
  createAttempt,
  regenerateQuestionAudio,
  startAttempt,
} from "./service";

export interface CandidateFormState {
  error: string | null;
  fieldErrors?: Record<string, string>;
}

const detailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "Keep your name under 120 characters."),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Enter a valid email address.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v.toLowerCase() : null)),
  phone: z
    .string()
    .trim()
    .max(32, "Keep the phone number under 32 characters.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

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

  const parsed = detailsSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
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

  const { attemptId, accessToken } = await createAttempt(interview, {
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });

  // The only time this token leaves the server. From here on the cookie is
  // what proves the candidate owns this attempt.
  await setAttemptCookie(accessToken);
  redirect(`/attempt/${attemptId}`);
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

/** Used when detection was unusable and the candidate picked a language. */
export async function chooseLanguageAction(
  attemptId: string,
  languageKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const found = await getAttemptForCandidate(attemptId);
  if (!found) return { ok: false, error: "Your session has expired." };

  try {
    await chooseLanguage(found.attempt, found.interview, languageKey);
    revalidatePath(`/attempt/${attemptId}`);
    return { ok: true };
  } catch (error) {
    console.error("[attempt] language choice failed", error);
    return { ok: false, error: "Could not set that language." };
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
