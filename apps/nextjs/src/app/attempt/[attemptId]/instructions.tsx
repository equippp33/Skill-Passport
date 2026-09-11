"use client";

import { Icon } from "~/components/ui/icon";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui";
import { CandidateSplit } from "~/components/candidate-split";
import { CameraPreview } from "~/components/camera-preview";
import { t } from "~/config/messages";
import type { Messages } from "~/config/messages";
import { PROBE_PROMPTS } from "~/config/greeting";
import { useAnswerRecorder } from "~/hooks/use-answer-recorder";
import { startAttemptAction } from "~/server/attempt/actions";
import { MAX_ANSWER_SECONDS } from "./constants";

/**
 * Pre-interview instructions and device check.
 *
 * Nothing is recorded here. The mic test opens the camera and microphone and
 * keeps them on so the candidate can see their own self-view while they read —
 * a real device check, not a one-shot permission prompt. The interview itself
 * does not begin until consent is ticked and Start is pressed; the devices are
 * released again when this screen unmounts.
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

  // Hand the devices back when leaving the check — the interview screen opens
  // its own stream, so holding the camera past here is a needless red light.
  const releaseDevices = recorder.release;
  useEffect(() => releaseDevices, [releaseDevices]);

  async function handleMicTest() {
    // Read the outcome from the return value: the hook's state has not
    // re-rendered yet at this point.
    const { granted, hasCamera } = await recorder.requestPermission();
    setMicTested(granted);
    setCameraReady(hasCamera);
    // Devices are left on so the self-view stays live while they read.
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

  const canStart = consented && micTested && aiReady && !isStarting;

  return (
    <CandidateSplit
      step={2}
      camera={
        <CameraPreview
          stream={recorder.previewStream}
          className="h-56 w-full lg:h-full lg:aspect-auto"
          hint={
            micTested
              ? undefined
              : "Test your microphone below to turn on your camera."
          }
        />
      }
    >
      <header>
        <p className="text-xs font-medium tracking-widest text-content-muted uppercase">
          {m.instructions.title}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {interviewTitle}
        </h1>
        <p className="mt-1.5 text-sm text-content-muted">
          {m.dashboard.assessmentName} · {questionCount} {m.dashboard.questions}{" "}
          ·{" "}
          {t(m.instructions.duration, {
            minutes: estimatedMinutes,
            count: questionCount,
          })}
        </p>
      </header>

      {interviewDescription ? (
        <p className="max-w-prose text-sm leading-relaxed text-content-muted text-pretty">
          {interviewDescription}
        </p>
      ) : null}

      {/* Offered in several scripts rather than assuming the candidate
          reads English. */}
      <Card className="border-accent/15 bg-accent-soft">
        <CardContent className="pt-5">
          <p className="text-xs font-medium tracking-widest text-content-muted uppercase">
            {m.instructions.ownLanguageTitle}
          </p>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
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
          answer three different questions. */}
      <Card>
        <CardHeader>
          <CardTitle>{m.instructions.expectTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              heading: m.instructions.groupHowItWorks,
              points: [
                m.instructions.skillsCovered,
                t(m.instructions.answerLimit, {
                  seconds: MAX_ANSWER_SECONDS,
                }),
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
                t(m.instructions.languageNotice, {
                  language: languageName,
                }),
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

      {/* The "am I ready" controls: mic test, consent and Start, grouped so
          the whole decision reads as one block at the end of the details. */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Icon name="mic" className="size-4 text-accent" />
              {m.instructions.micCheckTitle}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
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
              <p className="mt-2 text-sm text-content-muted">
                {recorder.cameraError} {m.instructions.cameraOptional}
              </p>
            ) : null}

            {recorder.errorMessage ? (
              <Alert
                tone="danger"
                title={m.instructions.micUnavailable}
                className="mt-3"
              >
                {recorder.errorMessage}
              </Alert>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-subtle bg-canvas p-4 text-sm leading-relaxed">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-accent"
            />
            <span>{m.instructions.consent}</span>
          </label>

          {!aiReady ? (
            <Alert tone="warning" title={m.instructions.notConfiguredTitle}>
              {m.instructions.notConfiguredBody}
            </Alert>
          ) : null}

          {startError ? <Alert tone="danger">{startError}</Alert> : null}

          <div>
            <Button
              size="lg"
              className="w-full"
              aria-busy={isStarting}
              onClick={handleStart}
              disabled={!canStart}
            >
              {isStarting ? m.instructions.starting : m.instructions.start}
            </Button>
            {aiReady && (!consented || !micTested) ? (
              <p className="mt-2 text-center text-sm text-content-muted">
                {!micTested
                  ? m.instructions.needMic
                  : m.instructions.needConsent}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </CandidateSplit>
  );
}
