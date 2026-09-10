import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, EmptyState, buttonClasses } from "~/components/ui";
import { listInterviews, requireAdmin } from "~/server/admin/service";
import { formatDate } from "~/lib/utils";
import { InterviewDialogSlot } from "../interview-dialog-slot";
import { OpenInterviewButton } from "../open-interview-button";

export const metadata: Metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function AdminInterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ interview?: string }>;
}) {
  const admin = await requireAdmin("/admin/interviews");
  const { interview: openInterviewId } = await searchParams;
  const interviews = await listInterviews(admin.id);

  return (
    <>
      <div className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Interviews
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            {interviews.length} in total.
          </p>
        </div>
        <Link href="/admin" className={buttonClasses("primary", "md")}>
          New interview
        </Link>
      </div>

      {interviews.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          description="Create your first one from the overview page."
          action={
            <Link href="/admin" className={buttonClasses("primary", "md")}>
              Go to overview
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {interviews.map((interview) => (
            <li key={interview.id}>
              <Card className="transition-colors hover:border-border-strong">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">
                        {interview.title}
                      </h2>
                      <span
                        className={
                          interview.isOpen
                            ? "rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success"
                            : "rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-content-muted"
                        }
                      >
                        {interview.isOpen ? "Open" : "Closed"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-content-muted">
                      {interview.attemptCount} candidate
                      {interview.attemptCount === 1 ? "" : "s"} ·{" "}
                      {interview.completedCount} completed ·{" "}
                      {interview.questionCount} questions ·{" "}
                      {formatDate(interview.createdAt)}
                    </p>
                  </div>

                  <OpenInterviewButton
                    interviewId={interview.id}
                    interviewTitle={interview.title}
                    basePath="/admin/interviews"
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <InterviewDialogSlot adminId={admin.id} interviewId={openInterviewId} />
    </>
  );
}
