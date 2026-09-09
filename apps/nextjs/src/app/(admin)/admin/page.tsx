import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  buttonClasses,
} from "~/components/ui";
import {
  getAdminStats,
  listInterviews,
  requireAdmin,
} from "~/server/admin/service";
import { formatDate } from "~/lib/utils";
import { CreateInterviewForm } from "./create-form";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium tracking-wide text-content-muted uppercase">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? (
          <p className="mt-0.5 text-xs text-content-muted">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const admin = await requireAdmin("/admin");
  const [stats, interviews] = await Promise.all([
    getAdminStats(admin.id),
    listInterviews(admin.id),
  ]);

  const recent = interviews.slice(0, 5);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-content-muted">
            Create an interview, share its link, and review what candidates
            said.
          </p>
        </div>
        <Link
          href="/admin/interviews"
          className={buttonClasses("secondary", "md")}
        >
          All interviews
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Interviews"
          value={stats.interviews}
          hint={`${stats.openInterviews} open`}
        />
        <Stat label="Candidates" value={stats.attempts} />
        <Stat
          label="Completed"
          value={stats.completed}
          hint={
            stats.inProgress > 0 ? `${stats.inProgress} in progress` : undefined
          }
        />
        <Stat
          label="Average score"
          value={
            stats.averageScore === null ? "—" : `${stats.averageScore}/100`
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New interview</CardTitle>
          <CardDescription>
            Every candidate who opens the link gets their own attempt, in
            whichever language they speak.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateInterviewForm />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Recent</h2>
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
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">
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

                    <Link
                      href={`/admin/interviews/${interview.id}`}
                      className={buttonClasses("secondary", "sm")}
                    >
                      Open
                    </Link>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
