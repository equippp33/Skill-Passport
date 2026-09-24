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

            {/*
             * What this link has cost so far, by provider. Development only —
             * the server omits `devCosts` entirely in production, so this
             * renders nothing there.
             *
             * The counts sit beside the total on purpose: a figure covering
             * four runs out of seven reads as the whole bill unless it says
             * otherwise, and the unmetered ones are interviews that predate
             * the counters, not free ones.
             */}
            {details.devCosts ? (
              <div className="mt-3 inline-flex flex-wrap items-stretch gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle text-sm">
                {[
                  ["OpenAI", details.devCosts.openai],
                  ["TTS", details.devCosts.tts],
                  ["STT", details.devCosts.stt],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface px-3 py-1.5">
                    <div className="text-[11px] tracking-wide text-content-muted uppercase">
                      {label}
                    </div>
                    <div className="font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
                <div className="bg-accent-soft px-3 py-1.5">
                  <div className="text-[11px] tracking-wide text-content-muted uppercase">
                    Total
                  </div>
                  <div
                    className="font-semibold text-accent tabular-nums"
                    title={
                      details.devCosts.hasFloor
                        ? "A floor: some interviews predate the meter, so their model usage is missing and the real total is higher"
                        : "Estimated from provider list prices — see config/pricing.ts"
                    }
                  >
                    {details.devCosts.hasFloor ? "≥" : ""}
                    {details.devCosts.total}
                  </div>
                </div>
              </div>
            ) : null}
            {details.devCosts ? (
              <p className="mt-1 text-xs text-content-muted">
                {details.devCosts.metered} interview
                {details.devCosts.metered === 1 ? "" : "s"} fully metered
                {details.devCosts.unmetered > 0
                  ? ` · ${details.devCosts.unmetered} priced from stored questions and answers only, so the model share is missing and the real total is higher`
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

      <CandidateGrid
        attempts={details.attempts}
        statusLabels={statusLabels}
        returnTo={`/admin/interviews/${details.id}`}
      />
    </div>
  );
}
