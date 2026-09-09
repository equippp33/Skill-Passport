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
}: {
  attemptId: string;
  questionCount: number;
  /** False when OPENAI_API_KEY is unset — starting would fail immediately. */
  aiReady: boolean;
  m: Messages;
  languageName: string;
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {m.instructions.title}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {m.dashboard.assessmentName} · {questionCount} {m.dashboard.questions}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m.instructions.expectTitle}</CardTitle>
          <CardDescription>{m.instructions.expectSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5 text-sm">
            {[
              t(m.instructions.duration, {
                minutes: estimatedMinutes,
                count: questionCount,
              }),
              m.instructions.skillsCovered,
              t(m.instructions.answerLimit, { seconds: MAX_ANSWER_SECONDS }),
              m.instructions.microphone,
              m.instructions.camera,
              m.instructions.noRetake,
              m.instructions.recorded,
              t(m.instructions.languageNotice, { language: languageName }),
              m.instructions.notHiring,
            ].map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span aria-hidden className="text-content-muted">
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
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
