import { Icon } from "~/components/ui/icon";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, EmptyState, buttonClasses } from "~/components/ui";
import {
  getAdminStats,
  listInterviews,
  requireAdmin,
} from "~/server/admin/service";
import { formatDate } from "~/lib/utils";
import { CreateInterview } from "./create-interview";
import { InterviewDialogSlot } from "./interview-dialog-slot";
import { OpenInterviewButton } from "./open-interview-button";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: "mic" | "people" | "check" | "report";
}) {
  return (
    <Card className="transition-colors hover:border-border-strong">
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-content-muted">{label}</p>
          <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent min-[420px]:grid">
            <Icon name={icon} />
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {value}
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs text-content-muted">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ interview?: string }>;
}) {
  const admin = await requireAdmin("/admin");
  const { interview: openInterviewId } = await searchParams;
  const [stats, interviews] = await Promise.all([
    getAdminStats(admin.id),
    listInterviews(admin.id),
  ]);

  const recent = interviews.slice(0, 5);

  return (
    <>
      <div className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Overview
          </h1>
          <p className="mt-1 text-sm text-content-muted">
            Understand workplace skills through AI-powered interviews.
          </p>
        </div>
        <Link
          href="/admin/interviews"
          className={buttonClasses("secondary", "md")}
        >
          All interviews
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat
          icon="mic"
          label="Interviews"
          value={stats.interviews}
          hint={`${stats.openInterviews} open`}
        />
        <Stat icon="people" label="Candidates" value={stats.attempts} />
        <Stat
          icon="check"
          label="Completed"
          value={stats.completed}
          hint={
            stats.inProgress > 0 ? `${stats.inProgress} in progress` : undefined
          }
        />
        <Stat
          icon="report"
          label="Average score"
          value={
            stats.averageScore === null ? "—" : `${stats.averageScore}/100`
          }
        />
      </div>

      <Card className="border-accent/15 bg-linear-to-br from-surface to-accent-soft">
        <CardContent className="pt-6">
          <CreateInterview />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Recent interviews
          </h2>
          {interviews.length > recent.length ? (
            <Link
              href="/admin/interviews"
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              View all {interviews.length}
            </Link>
          ) : null}
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="No interviews yet"
            description="Create one above to get a shareable link you can send to candidates."
          />
        ) : (
          <ul className="space-y-3">
            {recent.map((interview) => (
              <li key={interview.id}>
                <Card className="transition-colors hover:border-border-strong">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">
                          {interview.title}
                        </h3>
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
                        {formatDate(interview.createdAt)}
                      </p>
                    </div>

                    <OpenInterviewButton
                      interviewId={interview.id}
                      interviewTitle={interview.title}
                      basePath="/admin"
                    />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InterviewDialogSlot adminId={admin.id} interviewId={openInterviewId} />
    </>
  );
}
