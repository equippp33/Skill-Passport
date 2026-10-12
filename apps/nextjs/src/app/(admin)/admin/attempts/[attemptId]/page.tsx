import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AttemptReport } from "~/components/attempt-report";
import { Alert } from "~/components/ui";
import {
  getAttemptCosts,
  getAttemptForAdmin,
  getCandidateAttempts,
  getClipDurations,
  getScoreHistory,
  requireAdmin,
} from "~/server/admin/service";
import { AttemptComparison } from "./attempt-comparison";
import { AttemptCost } from "./attempt-cost";
import { getTurns } from "~/server/attempt/service";
import { uiMessages } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { formatDate } from "~/lib/utils";
import { safeReturnTo } from "~/lib/return-to";
import { appUrl } from "~/server/app-url";
import { DownloadReport } from "./download-report";
import { RescoreReport } from "./rescore-report";
import { ResendResult } from "./resend-result";

export const metadata: Metadata = { title: "Candidate" };
export const dynamic = "force-dynamic";

export default async function AdminAttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ from?: string; view?: string }>;
}) {
  const { attemptId: raw } = await params;
  const { from, view } = await searchParams;
  const admin = await requireAdmin("/admin");

  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const found = await getAttemptForAdmin(admin.id, parsed.data);
  if (!found) notFound();

  const { attempt, interview } = found;
  const [turns, clipDurations, appOrigin, candidateAttempts, costs, history] =
    await Promise.all([
      getTurns(attempt.id),
      getClipDurations(attempt.id),
      appUrl(),
      getCandidateAttempts(admin.id, attempt),
      // Undefined in production, so the strip below simply does not render.
      getAttemptCosts(admin.id, attempt),
      // Null in production. Carries every version this report has had.
      getScoreHistory(admin.id, attempt.id),
    ]);
  const m = uiMessages();
  const fromQuery = from ? `?from=${encodeURIComponent(from)}` : "";
  const fromParam = from ? `&from=${encodeURIComponent(from)}` : "";
  // The "Compare" tab is a view of THIS page, toggled by ?view=compare.
  const comparing = view === "compare" && candidateAttempts !== null;

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            data-print-hide
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

          <div data-print-hide className="flex items-center gap-2">
            {attempt.status === "completed" && attempt.externalStudentId ? (
              <ResendResult
                attemptId={attempt.id}
                delivered={attempt.resultDeliveredAt !== null}
              />
            ) : null}
            {attempt.status === "completed" ? (
              <RescoreReport attemptId={attempt.id} />
            ) : null}
            {/*
             * Development only, and only once there is more than one version
             * — a report nobody has re-scored has nothing to compare against.
             */}
            {history && history.rescoreCount > 0 ? (
              <Link
                href={`/admin/attempts/${attempt.id}/rescores`}
                // A new tab, so the report stays open behind it: the point of
                // the comparison is to read it against what is on screen.
                // `noopener` because `_blank` otherwise hands the new page a
                // live handle back to this one.
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted"
              >
                Compare {history.versions.length} versions
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className="size-3.5 text-content-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12M12 4h4v4M16 4l-6.5 6.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            ) : null}
            <DownloadReport attemptId={attempt.id} />
          </div>
        </div>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {attempt.candidateName}
        </h1>

        {/* Integration candidates only: whether the result reached the partner
            webhook. Others never trigger a webhook, so it says nothing. */}
        {attempt.externalStudentId ? (
          <p
            data-print-hide
            className={`mt-1 text-sm ${
              attempt.resultDeliveredAt
                ? "text-emerald-700"
                : "text-amber-700"
            }`}
          >
            {attempt.resultDeliveredAt
              ? `Result delivered to partner · ${formatDate(attempt.resultDeliveredAt)}`
              : "Result not yet delivered to partner"}
          </p>
        ) : null}

        {/* On screen the interview is named by the back link, which is not
            printed — so the document says for itself what it is. */}
        <p className="mt-1 hidden text-sm text-content-muted print:block">
          {interview.title} · report generated {formatDate(new Date())}
        </p>

        {/* Retakes: this candidate has more than one attempt. Each is its own
            report + recordings; the tabs switch between them (oldest first). */}
        {candidateAttempts ? (
          <div
            data-print-hide
            className="mt-4 flex flex-wrap gap-2 border-b border-border-subtle pb-3"
          >
            {candidateAttempts.attempts.map((tab) => {
              const active = tab.isCurrent && !comparing;
              return (
                <Link
                  key={tab.attemptId}
                  href={`/admin/attempts/${tab.attemptId}${fromQuery}`}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast"
                      : "rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:bg-surface-muted"
                  }
                >
                  Attempt {tab.attemptNumber}
                  <span
                    className={
                      active
                        ? "ml-1.5 text-accent-contrast/70"
                        : "ml-1.5 text-content-muted/70"
                    }
                  >
                    {tab.status === "completed"
                      ? tab.overallScore !== null
                        ? `${(tab.overallScore / 10).toFixed(1)}/10`
                        : "done"
                      : tab.status === "in_progress" ||
                          tab.status === "processing"
                        ? "in progress"
                        : tab.status === "failed"
                          ? "failed"
                          : "not started"}
                  </span>
                </Link>
              );
            })}
            {/* The side-by-side comparison, as its own tab. */}
            <Link
              href={`/admin/attempts/${attempt.id}?view=compare${fromParam}`}
              aria-current={comparing ? "page" : undefined}
              className={
                comparing
                  ? "rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast"
                  : "rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:bg-surface-muted"
              }
            >
              Compare
            </Link>
          </div>
        ) : null}

        {costs ? <AttemptCost costs={costs} /> : null}
      </div>

      {comparing ? (
        <AttemptComparison
          attempts={candidateAttempts.attempts}
          skills={candidateAttempts.skills}
        />
      ) : null}

      {!comparing && attempt.status !== "completed" ? (
        <Alert tone="warning">
          This attempt is not finished yet, so the report is partial.
        </Alert>
      ) : null}

      {!comparing ? (
        <AttemptReport
          attempt={attempt}
          turns={turns}
          clipDurations={clipDurations}
          appOrigin={appOrigin}
          m={m}
          showCandidate
        />
      ) : null}
    </>
  );
}
