import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Icon } from "~/components/ui/icon";
import { appUrl } from "~/server/app-url";
import { getInterviewDetails, requireAdmin } from "~/server/admin/service";
import { getMessages } from "~/config/messages";
import { uiLanguage } from "~/server/language";
import { uuidSchema } from "~/server/interview/validation";
import { formatDate } from "~/lib/utils";
import { OpenToggle } from "../../open-toggle";
import { ShareLink } from "../../share-link";
import { CandidateGrid } from "./candidate-grid";

export const metadata: Metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin("/admin/interviews");
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) notFound();

  const [details, appOrigin] = await Promise.all([
    getInterviewDetails(admin.id, parsed.data),
    appUrl(),
  ]);
  if (!details) notFound();

  const statusLabels = getMessages(uiLanguage().key).status;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/interviews"
          className="inline-flex items-center gap-1.5 text-sm text-content-muted underline-offset-4 hover:underline"
        >
          <Icon name="arrow" className="size-4 rotate-180" />
          All interviews
        </Link>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {details.title}
              </h1>
              <span
                className={
                  details.isOpen
                    ? "rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success"
                    : "rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-content-muted"
                }
              >
                {details.isOpen ? "Open" : "Closed"}
              </span>
            </div>
            <p className="mt-1 text-sm text-content-muted">
              {details.questionCount} skill questions · created{" "}
              {formatDate(details.createdAt)}
            </p>
          </div>
          <OpenToggle interviewId={details.id} isOpen={details.isOpen} />
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-accent/15 bg-accent-soft p-4">
        <h2 className="text-sm font-semibold">Candidate link</h2>
        <p className="text-sm text-content-muted">
          Share this with as many candidates as you like. Each one gets a
          separate attempt and cannot see anyone else&apos;s.
        </p>
        <ShareLink url={`${appOrigin}/i/${details.publicToken}`} />
        {!details.isOpen ? (
          <p className="text-sm text-danger">
            This interview is closed — the link will not accept new candidates.
          </p>
        ) : null}
      </section>

      <CandidateGrid
        attempts={details.attempts}
        statusLabels={statusLabels}
        returnTo={`/admin/interviews/${details.id}`}
      />
    </div>
  );
}
