import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "~/components/ui";
import { PROBE_PROMPTS } from "~/config/greeting";
import { getInterviewByPublicToken } from "~/server/attempt/access";
import { uiMessages } from "~/server/language";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "Start your interview" };
export const dynamic = "force-dynamic";

/**
 * Public landing page for a shared interview link.
 *
 * Not behind auth — anyone with the link can start. The link itself is the
 * credential, which is why the token is 256 bits of randomness rather than a
 * database id.
 */
export default async function CandidateLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const m = uiMessages();
  const interview = await getInterviewByPublicToken(token);

  if (!interview) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title="This link is not active"
          description="The interview may have been closed, or the link may be incomplete. Please check with whoever sent it to you."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-12">
      <div className="text-center">
        <p className="text-sm text-content-muted">{m.app.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {interview.title}
        </h1>
        {interview.description ? (
          <p className="mt-2 text-sm text-content-muted">
            {interview.description}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Before you start</CardTitle>
          <CardDescription>
            You will answer {interview.questionCount} short questions out loud.
            Your microphone and camera are recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Shown before any language is known, so it is offered in several
              scripts rather than assuming the candidate reads English. */}
          <div className="space-y-1.5 rounded-lg bg-surface-muted px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-content-muted uppercase">
              You can answer in your own language
            </p>
            {PROBE_PROMPTS.slice(0, 4).map((p) => (
              <p key={p.code} lang={p.code} className="text-sm leading-relaxed">
                {p.text}
              </p>
            ))}
          </div>

          <StartForm token={token} />
        </CardContent>
      </Card>
    </main>
  );
}
