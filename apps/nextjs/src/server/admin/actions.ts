"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createInterview, requireAdmin, setInterviewOpen } from "./service";

export interface AdminFormState {
  error: string | null;
  fieldErrors?: Record<string, string>;
}

const createSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give the interview a name.")
    .max(120, "Keep the name under 120 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/**
 * Create an interview and open its detail page, where the share link lives.
 *
 * `requireAdmin` runs first on every admin action, not just the pages — a
 * server action is a public endpoint and must carry its own authorization.
 */
export async function createInterviewAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin("/admin");

  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
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

  const interview = await createInterview(admin.id, {
    title: parsed.data.title,
    description: parsed.data.description,
  });

  revalidatePath("/admin");
  redirect(`/admin/interviews/${interview.id}`);
}

export async function setInterviewOpenAction(
  interviewId: string,
  isOpen: boolean,
): Promise<void> {
  const admin = await requireAdmin("/admin");
  await setInterviewOpen(admin.id, interviewId, isOpen);
  revalidatePath(`/admin/interviews/${interviewId}`);
  revalidatePath("/admin");
}
