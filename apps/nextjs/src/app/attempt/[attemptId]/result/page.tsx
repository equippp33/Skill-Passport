import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Icon } from "~/components/ui/icon";
import { HeaderProfile } from "~/components/header-profile";
import { getAttemptForCandidate } from "~/server/attempt/access";
import { uuidSchema } from "~/server/interview/validation";

export const metadata: Metadata = { title: "Interview submitted" };
export const dynamic = "force-dynamic";

/**
 * What the candidate sees when they finish.
 *
 * Deliberately NOT their report. Scores, per-skill marks and the written
 * evaluation are for the admin deciding on them — showing a number to the
 * person it judges invites them to argue with it, to re-take the interview
 * hunting for a better one, or to leave demoralised by a machine's opinion
 * they cannot question. None of that is the point of the assessment.
 *
 * So: confirmation that it arrived, and what happens next. The report still
 * exists in full on the admin side.
 */
export default async function AttemptResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId: raw } = await params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const found = await getAttemptForCandidate(parsed.data);
  if (!found) notFound();

  const { attempt, interview } = found;
  if (attempt.status !== "completed") {
    redirect(`/attempt/${attempt.id}`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-8">
      <HeaderProfile name={attempt.candidateName} />

      <div className="mt-6 rounded-2xl border border-success/20 bg-success-soft p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-surface text-success">
          <Icon name="check" className="size-7" />
        </span>

        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Interview submitted
        </h1>

        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-content-muted text-pretty">
          Thanks for your time, {attempt.candidateName.split(" ")[0]}. Your
          answers for {interview.title} have been received and are with the team
          now.
        </p>

        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-content-muted text-pretty">
          Someone will review them and get back to you. There is nothing more to
          do — you can close this page.
        </p>
      </div>
    </main>
  );
}
