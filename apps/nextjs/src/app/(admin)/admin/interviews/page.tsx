import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, EmptyState, buttonClasses } from "~/components/ui";
import { listInterviews, requireAdmin } from "~/server/admin/service";
import { formatDate } from "~/lib/utils";
import { OpenInterviewButton } from "../open-interview-button";

export const metadata: Metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function AdminInterviewsPage() {
  const admin = await requireAdmin("/admin/interviews");
  const interviews = await listInterviews(admin.id);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Interviews</h1>
          <p className="text-xs text-content-muted">
            {interviews.length} in total.
          </p>
        </div>
        <Link href="/admin" className={buttonClasses("primary", "sm")}>
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
        <ul className="space-y-1.5">
          {interviews.map((interview) => (
            <li key={interview.id}>
              <Card className="transition-colors hover:border-border-strong">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">
                        {interview.title}
                      </h2>
                      <span
                        className={
                          interview.isOpen
                            ? "rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success"
                            : "rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-content-muted"
                        }
                      >
                        {interview.isOpen ? "Open" : "Closed"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-content-muted">
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
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
