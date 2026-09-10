import { getInterviewDetails } from "~/server/admin/service";
import { uiLanguage } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { InterviewDialog } from "./interview-dialog";

/**
 * Renders the interview dialog for whatever `?interview=` points at.
 *
 * Both list pages mount this, so the dialog is defined in one place rather
 * than once per row. Fetching here — on the server, as part of the
 * navigation — is what lets the dialog itself hold no loading state.
 *
 * An id that is missing, malformed, or belongs to another admin simply
 * renders nothing, which is the right outcome for a hand-edited URL.
 */
export async function InterviewDialogSlot({
  adminId,
  interviewId,
}: {
  adminId: string;
  interviewId: string | undefined;
}) {
  const language = uiLanguage().key;

  const parsed = interviewId ? uuidSchema.safeParse(interviewId) : null;
  const details = parsed?.success
    ? await getInterviewDetails(adminId, parsed.data)
    : null;

  return <InterviewDialog details={details} uiLanguage={language} />;
}
