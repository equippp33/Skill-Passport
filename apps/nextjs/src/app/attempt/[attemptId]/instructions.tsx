"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui";
import { t } from "~/config/messages";
import type { Messages } from "~/config/messages";
import { PROBE_PROMPTS } from "~/config/greeting";
import { useAnswerRecorder } from "~/hooks/use-answer-recorder";
import { startAttemptAction } from "~/server/attempt/actions";
import { MAX_ANSWER_SECONDS } from "./constants";

/**
 * Pre-interview instructions and device check.
 *
 * Nothing is recorded here — the mic test only opens and immediately releases
 * the stream, and the interview itself does not begin until the candidate has
 * ticked consent and pressed Start.
 */
export function Instructions({
  attemptId,
  questionCount,
  aiReady,
  m,
  languageName,
  interviewTitle,
  interviewDescription,
}: {
  attemptId: string;
  questionCount: number;
  /** False when OPENAI_API_KEY is unset — starting would fail immediately. */
  aiReady: boolean;
  m: Messages;
  languageName: string;
  /** Named here too, so the candidate knows which interview they are in. */
  interviewTitle: string;
  interviewDescription: string | null;
}) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [micTested, setMicTested] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();

  // Ask for the camera here too, so a refusal is discovered during the
  // device check rather than mid-interview.
  const recorder = useAnswerRecorder({
    maxSeconds: MAX_ANSWER_SECONDS,
    withVideo: true,
  });

  const estimatedMinutes = Math.max(2, Math.round(questionCount * 2));

  async function handleMicTest() {
    // Read the outcome from the return value: the hook's state has not
    // re-rendered yet at this point.
    const { granted, hasCamera } = await recorder.requestPermission();
    setMicTested(granted);
    setCameraReady(hasCamera);
    // Release the devices again until the interview actually starts.
    if (granted) recorder.reset();
  }

  function handleStart() {
    setStartError(null);
    startTransition(async () => {
      const result = await startAttemptAction(attemptId);
      if (result.ok) {
        router.refresh();
      } else {
        setStartError(result.error ?? m.errors.generic);
      }
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <p className="text-xs font-medium tracking-widest text-content-muted uppercase">
          {m.instructions.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          {interviewTitle}
        </h1>
        <p className="mt-2 text-sm text-content-muted">
          {m.dashboard.assessmentName} · {questionCount} {m.dashboard.questions}{" "}
          ·{" "}
          {t(m.instructions.duration, {
            minutes: estimatedMinutes,
            count: questionCount,
          })}
        </p>
        {interviewDescription ? (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-content-muted text-pretty">
            {interviewDescription}
          </p>
        ) : null}
      </header>

      {/* Shown before any language is known, so it is offered in several
          scripts rather than assuming the candidate reads English. This is
          the last screen before the first question, which is where the
          reassurance is actually worth something. */}
      <Card>
        <CardContent className="pt-5">
          <p className="text-xs font-medium tracking-widest text-content-muted uppercase">
            {m.instructions.ownLanguageTitle}
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {PROBE_PROMPTS.slice(0, 4).map((prompt) => (
              <li
                key={prompt.code}
                lang={prompt.code}
                className="text-sm leading-relaxed text-pretty"
              >
                {prompt.text}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Grouped rather than one flat list of nine bullets: the points
          answer three different questions, and a reader scanning for "what
          do I need" should not have to filter out "what happens after". */}
      <Card>
        <CardHeader>
          <CardTitle>{m.instructions.expectTitle}</CardTitle>
          <CardDescription>{m.instructions.expectSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {[
            {
              heading: m.instructions.groupHowItWorks,
              points: [
                m.instructions.skillsCovered,
                t(m.instructions.answerLimit, { seconds: MAX_ANSWER_SECONDS }),
                m.instructions.noRetake,
              ],
            },
            {
              heading: m.instructions.groupWhatYouNeed,
              points: [m.instructions.microphone, m.instructions.camera],
            },
            {
              heading: m.instructions.groupYourAnswers,
              points: [
                m.instructions.recorded,
                t(m.instructions.languageNotice, { language: languageName }),
                m.instructions.notHiring,
              ],
            },
          ].map((group) => (
            <section key={group.heading}>
              <h3 className="text-xs font-medium tracking-widest text-content-muted uppercase">
                {group.heading}
              </h3>
              <ul className="mt-2 space-y-2">
                {group.points.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                    <span
                      aria-hidden
                      className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
                    />
                    <span className="text-pretty">{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.instructions.micCheckTitle}</CardTitle>
          <CardDescription>{m.instructions.micCheckSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleMicTest}
              disabled={recorder.state === "requesting"}
            >
              {recorder.state === "requesting"
                ? m.instructions.micTesting
                : micTested
                  ? m.instructions.micRetest
                  : m.instructions.micTest}
            </Button>

            <span className="text-sm" role="status" aria-live="polite">
              {micTested ? (
                <span className="text-success">
                  {cameraReady
                    ? m.instructions.micAndCameraReady
                    : m.instructions.micReadyNoCamera}
                </span>
              ) : (
                <span className="text-content-muted">
                  {m.instructions.micUntested}
                </span>
              )}
            </span>
          </div>

          {micTested && !cameraReady && recorder.cameraError ? (
            <p className="text-sm text-content-muted">
              {recorder.cameraError} {m.instructions.cameraOptional}
            </p>
          ) : null}

          {recorder.errorMessage ? (
            <Alert tone="danger" title={m.instructions.micUnavailable}>
              {recorder.errorMessage}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
            />
            <span>{m.instructions.consent}</span>
          </label>

          {!aiReady ? (
            <Alert tone="warning" title={m.instructions.notConfiguredTitle}>
              {m.instructions.notConfiguredBody}
            </Alert>
          ) : null}

          {startError ? <Alert tone="danger">{startError}</Alert> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={handleStart}
              disabled={!consented || !micTested || isStarting || !aiReady}
            >
              {isStarting ? m.instructions.starting : m.instructions.start}
            </Button>
            {aiReady && (!consented || !micTested) ? (
              <p className="text-sm text-content-muted">
                {!micTested
                  ? m.instructions.needMic
                  : m.instructions.needConsent}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
