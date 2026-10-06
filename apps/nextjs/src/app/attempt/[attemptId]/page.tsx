import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Alert } from "~/components/ui";
import { HeaderProfile } from "~/components/header-profile";
import { PreventBackNavigation } from "~/components/prevent-back-navigation";
import { resolveInterviewLanguage } from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import { FILLERS_BY_KEY, OPENING_BIT_PROMPTS_BY_KEY } from "~/config/greeting";
import { WORK_SKILL_COUNT, WORK_SKILL_IDS } from "~/config/work-skills";
import { getAttemptForCandidate } from "~/server/attempt/access";
import { getTurns } from "~/server/attempt/service";
import { uiMessages } from "~/server/language";
import { isOpenAIConfigured } from "~/server/services/openai";
import {
  beginActivitySession,
  recentActivity,
} from "~/server/services/dev-activity";
import { uuidSchema } from "~/server/interview/validation";
import { env } from "~/env";
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
      <main className="w-full">
        <HeaderProfile name={attempt.candidateName} />
        <PreventBackNavigation />
        <Instructions
          attemptId={attempt.id}
          questionCount={interview.questionCount}
          aiReady={isOpenAIConfigured()}
          m={m}
          languageName="your own language"
          languages={SELECTABLE_INTERVIEW_LANGUAGES.map((l) => ({
            key: l.key,
            displayName: l.displayName,
            promptName: l.promptName,
            symbol: l.symbol,
          }))}
          // English, not INTERVIEW_LANGUAGE: that env var is the default for
          // an instance, and pre-selecting Marathi from it meant a candidate
          // who did not read the grid carefully started an interview in a
          // language they had not chosen. English is the safe default to
          // deliberately change.
          defaultLanguage="english"
          interviewTitle={interview.title}
          interviewDescription={interview.description}
        />
      </main>
    );
  }

  if (attempt.status === "failed") {
    return (
      <main className="candidate-main">
        <HeaderProfile name={attempt.candidateName} />
        <Alert tone="danger" title={m.interview.errorTitle}>
          {attempt.errorMessage ?? m.errors.generic}
        </Alert>
      </main>
    );
  }

  const current =
    turns.find((t) => t.turnNumber === attempt.currentQuestionNumber) ?? null;

  // The language is fixed at the start, so it is always set here.
  const languageKey = (attempt.language ?? "english") as InterviewLanguageKey;
  const languageCode = resolveInterviewLanguage(languageKey).code;
  // The fixed clips are cached hard in the browser (immutable), but their voice
  // depends on the server-side speaker, which is NOT in the URL. So a voice
  // change would keep serving the old cached clip. Putting the speaker in the
  // URL makes it part of the cache key: switch voices and the browser fetches
  // fresh instead of replaying the previous speaker.
  const speaker = env.SARVAM_TTS_SPEAKER;
  // One URL per rotating filler variant, so the client can vary them per turn.
  const fillerUrls = FILLERS_BY_KEY[languageKey].map(
    (_, i) => `/api/filler/${languageKey}?v=${i}&s=${speaker}`,
  );
  // The opening turn's 2nd/3rd bits (hobbies, location), played in sequence
  // after each is answered. Speaker in the URL for the same cache-bust reason.
  const openingBitUrls = [0, 1].map(
    (b) => `/api/opening-bit/${languageKey}?b=${b}&s=${speaker}`,
  );

  return (
    // Fills the space the header leaves, so the interview sits centred in the
    // viewport instead of running past the fold.
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <HeaderProfile name={attempt.candidateName} />
      <PreventBackNavigation />
      <ActiveInterview
        attemptId={attempt.id}
        totalSkills={WORK_SKILL_COUNT}
        initialSkillNumber={
          current?.skillId ? WORK_SKILL_IDS.indexOf(current.skillId) + 1 : 0
        }
        initialQuestionNumber={attempt.currentQuestionNumber}
        initialAttemptStatus={attempt.status}
        fillerUrls={fillerUrls}
        checkUrl={`/api/check/${languageKey}?s=${speaker}`}
        openingBitUrls={openingBitUrls}
        openingBitTexts={[...OPENING_BIT_PROMPTS_BY_KEY[languageKey]]}
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
