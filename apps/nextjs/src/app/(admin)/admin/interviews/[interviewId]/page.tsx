import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusBadge,
  buttonClasses,
} from "~/components/ui";
import { INTERVIEW_LANGUAGES } from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import { getInterviewForAdmin, requireAdmin } from "~/server/admin/service";
import { uiMessages } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { formatDate } from "~/lib/utils";
import { ShareLink } from "./share-link";

export const metadata: Metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

function languageLabel(key: string | null): string {
  if (!key) return "—";
  const found = INTERVIEW_LANGUAGES[key as InterviewLanguageKey];
  return found ? `${found.displayName} (${found.code})` : key;
}

export default async function AdminInterviewPage({
  params,
}: {
  params: Promise<{ interviewId: string }>;
}) {
  const { interviewId: raw } = await params;
  const admin = await requireAdmin("/admin");
  const m = uiMessages();

  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const found = await getInterviewForAdmin(admin.id, parsed.data);
  if (!found) notFound();

  const { interview, attempts } = found;

  return (
    <>
      <div>
        <Link
          href="/admin"
          className="text-sm text-content-muted underline-offset-4 hover:underline"
        >
          ← All interviews
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {interview.title}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {interview.questionCount} skill questions · created{" "}
          {formatDate(interview.createdAt)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidate link</CardTitle>
          <CardDescription>
            Share this with as many candidates as you like. Each one gets a
            separate attempt and cannot see anyone else&apos;s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShareLink path={`/i/${interview.publicToken}`} />
          {!interview.isOpen ? (
            <p className="mt-3 text-sm text-danger">
              This interview is closed — the link will not accept new
              candidates.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Attempts ({attempts.length})
        </h2>

        {attempts.length === 0 ? (
          <EmptyState
            title="No attempts yet"
            description="Attempts appear here as soon as a candidate opens the link and begins."
          />
        ) : (
          <ul className="space-y-3">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">
                          {attempt.candidateName}
                        </h3>
                        <StatusBadge
                          status={attempt.status}
                          label={
                            m.status[attempt.status as keyof typeof m.status]
                          }
                        />
                      </div>
                      <p className="mt-1 text-sm text-content-muted">
                        {attempt.candidateEmail ?? "no email"} ·{" "}
                        {languageLabel(attempt.language)} ·{" "}
                        {formatDate(attempt.createdAt)}
                        {attempt.awayCount > 0
                          ? ` · left tab ${attempt.awayCount}×`
                          : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      {attempt.overallScore !== null ? (
                        <div className="text-right">
                          <p className="text-lg font-semibold tabular-nums">
                            {attempt.overallScore}
                            <span className="text-sm text-content-muted">
                              /100
                            </span>
                          </p>
                        </div>
                      ) : null}
                      <Link
                        href={`/admin/attempts/${attempt.id}`}
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
      </section>
    </>
  );
}
