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
import { CandidateSection } from "./candidate-section";

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

            {/*
             * What this link has cost so far, by provider. Development only —
             * the server omits `devCosts` entirely in production, so this
             * renders nothing there.
             *
             * The counts sit beside the total on purpose: a figure covering
             * four runs out of seven reads as the whole bill unless it says
             * otherwise, and the unmetered ones are interviews that predate
             * the counters, not free ones.
             *
             * OpenAI and Sarvam get a line each rather than one "model" line,
             * because the fallback moves work between them and their rates are
             * about six times apart.
             *
             * A "~" means part of the figure is modelled: Sarvam recorded no
             * tokens before 6 October 2026, so for older interviews its share
             * is reconstructed from how many questions each one got through.
             * The alternative was ₹0.00, which reads as "Sarvam was free"
             * rather than "nobody counted".
             *
             * The average is per COMPLETED interview, which is why it is not
             * the total divided by the attempt count.
             */}
            {details.devCosts ? (
              <div className="mt-3 inline-flex flex-wrap items-stretch gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle text-sm">
                {(
                  [
                    ["OpenAI", details.devCosts.openai, false],
                    ["Sarvam", details.devCosts.sarvam, details.devCosts.hasEstimate],
                    ["TTS", details.devCosts.tts, false],
                    ["STT", details.devCosts.stt, false],
                    [
                      "Avg / completed",
                      details.devCosts.average ?? "₹—",
                      details.devCosts.hasEstimate,
                    ],
                  ] as [string, string, boolean][]
                ).map(([label, value, approx]) => (
                  <div key={label} className="bg-surface px-3 py-1.5">
                    <div className="text-[11px] tracking-wide text-content-muted uppercase">
                      {label}
                    </div>
                    <div className="font-semibold tabular-nums">
                      {approx ? "~" : ""}
                      {value}
                    </div>
                  </div>
                ))}
                <div className="bg-accent-soft px-3 py-1.5">
                  <div className="text-[11px] tracking-wide text-content-muted uppercase">
                    Total
                  </div>
                  <div
                    className="font-semibold text-accent tabular-nums"
                    title={
                      details.devCosts.hasEstimate
                        ? "Part modelled: Sarvam recorded no tokens before 6 Oct 2026, so its share is reconstructed from interview length — close in aggregate, loose on any one run"
                        : "Estimated from provider list prices — see config/pricing.ts"
                    }
                  >
                    {details.devCosts.hasEstimate ? "~" : ""}
                    {details.devCosts.total}
                  </div>
                </div>
              </div>
            ) : null}
            {details.devCosts ? (
              <p className="mt-1 text-xs text-content-muted">
                Totals cover every attempt, retakes included
                {details.devCosts.averageBasis > 0
                  ? `; the average is over the ${details.devCosts.averageBasis} completed`
                  : ""}
                . {details.devCosts.measured} measured outright
                {details.devCosts.estimatedCount > 0
                  ? ` · ${details.devCosts.estimatedCount} with Sarvam's share reconstructed from interview length, since nothing recorded its tokens before 6 Oct`
                  : ""}
                {details.devCosts.hasFloor
                  ? " · some speech priced from stored question text, so that part is a floor"
                  : ""}
                . Realtime STT is billed per second of audio, so the WebSocket
                itself costs nothing beyond the STT line.
              </p>
            ) : null}
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

      <CandidateSection
        comparison={details.repeatComparison ?? []}
        returnTo={`/admin/interviews/${details.id}`}
      >
        <CandidateGrid
          attempts={details.attempts}
          statusLabels={statusLabels}
          returnTo={`/admin/interviews/${details.id}`}
        />
      </CandidateSection>
    </div>
  );
}
