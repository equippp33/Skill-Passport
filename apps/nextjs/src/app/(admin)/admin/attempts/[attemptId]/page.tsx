import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AttemptReport } from "~/components/attempt-report";
import { Alert } from "~/components/ui";
import { getAttemptForAdmin, requireAdmin } from "~/server/admin/service";
import { getTurns } from "~/server/attempt/service";
import { uiMessages } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";

export const metadata: Metadata = { title: "Attempt" };
export const dynamic = "force-dynamic";

export default async function AdminAttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: raw } = await params;
  const admin = await requireAdmin("/admin");

  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const found = await getAttemptForAdmin(admin.id, parsed.data);
  if (!found) notFound();

  const { attempt, interview } = found;
  const turns = await getTurns(attempt.id);
  const m = uiMessages();

  return (
    <>
      <div>
        <Link
          href={`/admin/interviews/${interview.id}`}
          className="text-sm text-content-muted underline-offset-4 hover:underline"
        >
          ← {interview.title}
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

      <AttemptReport attempt={attempt} turns={turns} m={m} showCandidate />
    </>
  );
}
