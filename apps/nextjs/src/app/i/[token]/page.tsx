import type { Metadata } from "next";

import { Card, CardContent, EmptyState } from "~/components/ui";
import { getInterviewByPublicToken } from "~/server/attempt/access";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "Start your interview" };
export const dynamic = "force-dynamic";

/**
 * Public landing page for a shared interview link.
 *
 * Not behind auth — anyone with the link can start. The link itself is the
 * credential, which is why the token is 256 bits of randomness rather than a
 * database id.
 *
 * Deliberately asks one thing: who are you. The briefing — how long it
 * takes, what is recorded, that any language is welcome — is on the next
 * page, where it sits next to the microphone check and the consent box it
 * relates to. Splitting it across both pages meant reading the same points
 * twice before answering a single question.
 */
export default async function CandidateLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const interview = await getInterviewByPublicToken(token);

  if (!interview) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          headingLevel={1}
          title="This link is not active"
          description="The interview may have been closed, or the link may be incomplete. Please check with whoever sent it to you."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-7 px-4 py-8 sm:py-12">
      <header className="text-center">
        <p className="eyebrow">YOUR SKILLS. YOUR VOICE.</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          {interview.title}
        </h1>
        {interview.description ? (
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-content-muted text-pretty">
            {interview.description}
          </p>
        ) : null}
      </header>

      <ol
        aria-label="Interview steps"
        className="grid grid-cols-3 gap-2 text-center text-xs font-medium"
      >
        <li
          aria-current="step"
          className="rounded-xl bg-accent-soft px-2 py-3 text-accent"
        >
          1 / Your details
        </li>
        <li className="rounded-xl bg-surface-muted px-2 py-3 text-content-muted">
          2 / Device check
        </li>
        <li className="rounded-xl bg-surface-muted px-2 py-3 text-content-muted">
          3 / Interview
        </li>
      </ol>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Your details
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-content-muted">
              So we know whose assessment this is. You will see what to expect
              on the next page before anything is recorded.
            </p>
          </div>

          <StartForm token={token} />
        </CardContent>
      </Card>
    </main>
  );
}
