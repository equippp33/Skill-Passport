import "server-only";

import { appUrl } from "~/server/app-url";
import { lucia } from "~/server/auth/lucia";
import { renderPageToPdf } from "~/server/pdf";
import type { Interview, InterviewAttempt } from "~/server/db/schema";

/**
 * Render an attempt's admin report page to PDF for the partner pull endpoint.
 *
 * The report page is behind admin login, and the partner has no admin session
 * — so we mint a throwaway Lucia session for the admin who OWNS the interview,
 * let the headless browser fetch the page as them, then invalidate it. This
 * reuses the exact report the admin sees (Indic scripts shaped correctly, per
 * `~/server/pdf`) rather than rebuilding the layout for print.
 */
export async function renderAttemptReportPdf(
  attempt: InterviewAttempt,
  interview: Interview,
): Promise<Buffer> {
  const session = await lucia.createSession(interview.createdByUserId, {});
  try {
    const origin = await appUrl();
    const { hostname } = new URL(origin);
    return await renderPageToPdf({
      url: `${origin}/admin/attempts/${attempt.id}`,
      cookies: [
        { name: lucia.sessionCookieName, value: session.id, domain: hostname },
      ],
    });
  } finally {
    await lucia.invalidateSession(session.id).catch(() => undefined);
  }
}
