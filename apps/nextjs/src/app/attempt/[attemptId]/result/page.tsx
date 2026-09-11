import { Icon } from "~/components/ui/icon";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AttemptReport } from "~/components/attempt-report";
import { HeaderProfile } from "~/components/header-profile";
import { getAttemptForCandidate } from "~/server/attempt/access";
import { getTurns } from "~/server/attempt/service";
import { uiMessages } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { formatDate } from "~/lib/utils";
import { t } from "~/config/messages";

export const metadata: Metadata = { title: "Your result" };
export const dynamic = "force-dynamic";

/**
 * The candidate's own report.
 *
 * `showCandidate` is off: they do not need their own contact details read
 * back, and the proctoring signal is for the admin, not for them.
 */
export default async function AttemptResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: raw } = await params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const found = await getAttemptForCandidate(parsed.data);
  if (!found) notFound();

  const { attempt, interview } = found;
  if (attempt.status !== "completed") {
    redirect(`/attempt/${attempt.id}`);
  }

  const turns = await getTurns(attempt.id);
  const m = uiMessages();

  return (
    <main className="mx-auto w-full max-w-350 space-y-6 px-4 py-8 sm:px-8">
      <HeaderProfile name={attempt.candidateName} />
      <div className="rounded-2xl border border-success/20 bg-success-soft p-6">
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-surface text-success">
          <Icon name="check" className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          {m.result.title}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {interview.title} ·{" "}
          {t(m.result.completedOn, { date: formatDate(attempt.completedAt) })}
        </p>
      </div>

      <AttemptReport attempt={attempt} turns={turns} m={m} />

      <p className="rounded-xl border border-border-subtle bg-surface p-4 text-center text-sm text-content-muted">
        Thank you for completing the interview. You can close this page.
      </p>
    </main>
  );
}
