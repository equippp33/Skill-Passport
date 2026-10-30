import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { AttemptReport } from "~/components/attempt-report";
import { db } from "~/server/db";
import { interviewAttemptsTable } from "~/server/db/schema";
import { getClipDurations } from "~/server/admin/service";
import { getTurns } from "~/server/attempt/service";
import { appUrl } from "~/server/app-url";
import { uiMessages } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { signShareId, verifyShareToken } from "~/server/media-share";

export const dynamic = "force-dynamic";
// A public report must never be indexed, even though the token makes the URL
// unguessable — one leaked link should not become a search result.
export const metadata: Metadata = {
  title: "Interview report",
  robots: { index: false, follow: false },
};

/**
 * A full candidate report viewable by anyone holding the share link.
 *
 * The `?t=` token is an HMAC of the attempt id (see `~/server/media-share`): no
 * account, no cookie, and it authorises this one report only. The same signer
 * tokens each embedded clip, so the recordings play through the normal media
 * route while the bucket stays private. An invalid or missing token is a 404 —
 * indistinguishable from an attempt that does not exist.
 */
export default async function SharedReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { attemptId: raw } = await params;
  const { t } = await searchParams;

  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();
  if (!verifyShareToken(parsed.data, t)) notFound();

  const attempt = await db.query.interviewAttemptsTable.findFirst({
    where: eq(interviewAttemptsTable.id, parsed.data),
  });
  if (!attempt) notFound();

  const [turns, clipDurations, appOrigin] = await Promise.all([
    getTurns(attempt.id),
    getClipDurations(attempt.id),
    appUrl(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <AttemptReport
        attempt={attempt}
        turns={turns}
        clipDurations={clipDurations}
        appOrigin={appOrigin}
        m={uiMessages()}
        showCandidate
        mediaToken={signShareId}
      />
    </main>
  );
}
