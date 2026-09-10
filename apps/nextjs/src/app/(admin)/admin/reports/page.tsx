import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  EmptyState,
  StatusBadge,
  buttonClasses,
} from "~/components/ui";
import { listReports, requireAdmin } from "~/server/admin/service";
import { uiMessages } from "~/server/language";
import { formatSpokenLanguages } from "~/lib/spoken-languages";
import { formatDate } from "~/lib/utils";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/**
 * Every candidate, across every interview.
 *
 * The interview pages answer "how is this interview going". This answers
 * "who has been assessed", which is the question you have when you are
 * looking for a person rather than a link — and the only place a candidate
 * from an interview you have forgotten the name of is findable.
 */
export default async function AdminReportsPage() {
  const admin = await requireAdmin("/admin/reports");
  const [reports, m] = [await listReports(admin.id), uiMessages()];

  const scored = reports.filter((r) => r.overallScore !== null);
  const average =
    scored.length > 0
      ? Math.round(
          scored.reduce((sum, r) => sum + (r.overallScore ?? 0), 0) /
            scored.length,
        )
      : null;

  return (
    <>
      <div className="page-heading">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Reports
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {reports.length} candidate{reports.length === 1 ? "" : "s"}
          {scored.length > 0 ? ` · ${scored.length} scored` : ""}
          {average !== null ? ` · ${average}/100 average` : ""}
        </p>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          description="Reports appear here as soon as someone opens an interview link and begins."
          action={
            <Link href="/admin" className={buttonClasses("primary", "md")}>
              Create an interview
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.attemptId}>
              <Card className="transition-colors hover:border-border-strong">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">
                        {report.candidateName}
                      </h2>
                      <StatusBadge
                        status={report.status}
                        label={
                          m.status[report.status as keyof typeof m.status] ??
                          report.status
                        }
                      />
                    </div>

                    <p className="mt-1 text-sm text-content-muted">
                      {report.interviewTitle} ·{" "}
                      {report.candidateEmail ?? "no email"} ·{" "}
                      {formatSpokenLanguages(
                        report.spokenLanguages,
                        report.language,
                      )}{" "}
                      · {formatDate(report.completedAt ?? report.createdAt)}
                      {report.awayCount > 0
                        ? ` · left tab ${report.awayCount}×`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    {report.overallScore !== null ? (
                      <p className="text-lg font-semibold tabular-nums">
                        {report.overallScore}
                        <span className="text-sm text-content-muted">/100</span>
                      </p>
                    ) : null}
                    <Link
                      href={`/admin/attempts/${report.attemptId}?from=${encodeURIComponent(
                        "/admin/reports",
                      )}`}
                      className={buttonClasses("secondary", "sm")}
                    >
                      View
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
