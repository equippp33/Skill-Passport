import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Alert } from "~/components/ui";
import {
  SELECTABLE_INTERVIEW_LANGUAGES,
  resolveInterviewLanguage,
} from "~/config/languages";
import { PROBE_SPOKEN_LANGUAGE_CODE } from "~/config/greeting";
import { totalTurns } from "~/config/work-skills";
import { getAttemptForCandidate } from "~/server/attempt/access";
import { getTurns } from "~/server/attempt/service";
import { uiMessages } from "~/server/language";
import { isOpenAIConfigured } from "~/server/services/openai";
import { uuidSchema } from "~/server/interview/validation";
import { ActiveInterview } from "./active-interview";
import { Instructions } from "./instructions";

export const metadata: Metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

/**
 * The candidate's interview.
 *
 * Access is the attempt cookie, not a login — a wrong or missing cookie is a
 * 404, identical to a non-existent attempt, so poking at ids reveals nothing.
 */
export default async function AttemptPage({
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
  const m = uiMessages();

  if (attempt.status === "completed") {
    redirect(`/attempt/${attempt.id}/result`);
  }

  const turns = await getTurns(attempt.id);

  if (attempt.status === "not_started" || turns.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Instructions
          attemptId={attempt.id}
          questionCount={interview.questionCount}
          aiReady={isOpenAIConfigured()}
          m={m}
          languageName="your own language"
        />
      </main>
    );
  }

  if (attempt.status === "failed") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Alert tone="danger" title={m.interview.errorTitle}>
          {attempt.errorMessage ?? m.errors.generic}
        </Alert>
      </main>
    );
  }

  const current =
    turns.find((t) => t.turnNumber === attempt.currentQuestionNumber) ?? null;

  // Before detection the question is spoken in the neutral probe language.
  const languageCode = attempt.language
    ? resolveInterviewLanguage(attempt.language).code
    : PROBE_SPOKEN_LANGUAGE_CODE;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <ActiveInterview
        attemptId={attempt.id}
        totalTurns={totalTurns(interview.questionCount)}
        initialQuestionNumber={attempt.currentQuestionNumber}
        initialAttemptStatus={attempt.status}
        initialNeedsLanguage={attempt.needsLanguageChoice}
        languages={SELECTABLE_INTERVIEW_LANGUAGES.map((l) => ({
          key: l.key,
          displayName: l.displayName,
          promptName: l.promptName,
        }))}
        initialTurn={
          current
            ? {
                turnNumber: current.turnNumber,
                kind: current.kind,
                question: current.question,
                questionTranslation: current.questionTranslation,
                questionAudioId: current.questionAudioId,
                status: current.status,
                errorMessage: current.errorMessage,
                skillId: current.skillId,
              }
            : null
        }
        m={m}
        languageCode={languageCode}
      />
    </main>
  );
}
