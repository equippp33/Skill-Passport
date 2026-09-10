import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AttemptReport } from "~/components/attempt-report";
import { Alert } from "~/components/ui";
import {
  getAttemptForAdmin,
  getClipDurations,
  requireAdmin,
} from "~/server/admin/service";
import { getTurns } from "~/server/attempt/service";
import { uiMessages } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { safeReturnTo } from "~/lib/return-to";

export const metadata: Metadata = { title: "Candidate" };
export const dynamic = "force-dynamic";

export default async function AdminAttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { attemptId: raw } = await params;
  const { from } = await searchParams;
  const admin = await requireAdmin("/admin");

  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const found = await getAttemptForAdmin(admin.id, parsed.data);
  if (!found) notFound();

  const { attempt, interview } = found;
  const [turns, clipDurations] = await Promise.all([
    getTurns(attempt.id),
    getClipDurations(attempt.id),
  ]);
  const m = uiMessages();

  return (
    <>
      <div>
        <Link
          href={safeReturnTo(from)}
          className="inline-flex items-center gap-1.5 text-sm text-content-muted underline-offset-4 hover:underline"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              d="M12 4 6 10l6 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to {interview.title}
        </Link>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {attempt.candidateName}
        </h1>
      </div>

      {attempt.status !== "completed" ? (
        <Alert tone="warning">
          This attempt is not finished yet, so the report is partial.
        </Alert>
      ) : null}

      <AttemptReport
        attempt={attempt}
        turns={turns}
        clipDurations={clipDurations}
        m={m}
        showCandidate
      />
    </>
  );
}
