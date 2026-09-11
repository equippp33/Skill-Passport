import type { Metadata } from "next";

import { Card, CardContent, EmptyState } from "~/components/ui";
import { CandidateSplit } from "~/components/candidate-split";
import { CameraPreview } from "~/components/camera-preview";
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
    <main className="w-full">
      <CandidateSplit
        step={1}
        align="center"
        camera={
          <CameraPreview
            className="h-56 w-full lg:h-full lg:aspect-auto"
            hint="We'll check your camera and microphone on the next step. Nothing is recorded yet."
          />
        }
      >
        <header>
          <p className="eyebrow">YOUR SKILLS. YOUR VOICE.</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {interview.title}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-content-muted text-pretty">
            {interview.description ??
              "So we know whose assessment this is — nothing is recorded on this step."}
          </p>
        </header>

        <Card className="min-w-0">
          <CardContent className="space-y-4 pt-5">
            <StartForm token={token} />

            <p className="text-xs leading-relaxed text-content-muted">
              The interview is spoken. Find a quiet, well-lit spot and have your
              camera ready.
            </p>
          </CardContent>
        </Card>
      </CandidateSplit>
    </main>
  );
}
