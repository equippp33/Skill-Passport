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
import { useAnswerRecorder } from "~/hooks/use-answer-recorder";
import { startAttemptAction } from "~/server/attempt/actions";
import type { PickableLanguage } from "./language-picker";
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
  languages,
  defaultLanguage,
  interviewTitle,
  interviewDescription,
}: {
  attemptId: string;
  questionCount: number;
  /** False when OPENAI_API_KEY is unset — starting would fail immediately. */
  aiReady: boolean;
  m: Messages;
  languageName: string;
  /** Every language the interview can be conducted in. */
  languages: PickableLanguage[];
  /** Pre-selected from INTERVIEW_LANGUAGE, so there is always a sane default. */
  defaultLanguage: string;
  /** Named here too, so the candidate knows which interview they are in. */
  interviewTitle: string;
  interviewDescription: string | null;
}) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  /**
   * The language the whole interview runs in.
   *
   * Chosen here rather than inferred from the first answer: the candidate now
   * hears the very first question in the language they picked, and detection
   * is left to notice drift rather than to decide.
   */
  const [language, setLanguage] = useState(defaultLanguage);
  /**
   * What the candidate does, in their own words.
   *
   * Typed here rather than drawn out of the first spoken answer, so the FIRST
   * question can already be about their actual life instead of being asked
   * into a vacuum. Optional: a blank one costs a slightly more generic
   * interview, not a blocked one.
   */
  const [course, setCourse] = useState("");
  const [experience, setExperience] = useState("");
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
      const result = await startAttemptAction(attemptId, language, {
        course: course.trim() || null,
        experience: experience.trim() || null,
      });
      if (result.ok) {
        router.refresh();
      } else {
        setStartError(result.error ?? m.errors.generic);
      }
    });
  }

  const canStart =
    consented && micTested && aiReady && Boolean(language) && !isStarting;

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

      {/* The language choice, which used to be inferred from the candidate's
          first answer. A grid rather than the dropdown used mid-interview:
          here it is a decision to make, so every option should be visible at
          once instead of behind a click, and each is written in its own
          script so a candidate who does not read English can still find
          theirs. */}
      <Card className="border-accent/15 bg-accent-soft">
        <CardContent className="pt-5">
          <p className="text-xs font-medium tracking-widest text-content-muted uppercase">
            {m.instructions.backgroundTitle}
          </p>
          <p className="mt-1.5 max-w-prose text-sm text-content-muted text-pretty">
            {m.instructions.backgroundBody}
          </p>

          {/* Two questions rather than one open box. They answer different
              things — the course says what world to set a scenario in, the
              experience says whether this person has ever had a manager, a
              shift or a customer — and one box reliably got whichever the
              candidate happened to think of. */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label htmlFor="candidate-course" className="block">
              <span className="text-sm font-medium">
                {m.instructions.courseLabel}
              </span>
              <input
                id="candidate-course"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                maxLength={200}
                placeholder={m.instructions.coursePlaceholder}
                className="mt-1.5 w-full rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-content-muted/70 focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </label>

            <label htmlFor="candidate-experience" className="block">
              <span className="text-sm font-medium">
                {m.instructions.experienceLabel}
              </span>
              <textarea
                id="candidate-experience"
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                rows={2}
                maxLength={400}
                placeholder={m.instructions.experiencePlaceholder}
                className="mt-1.5 w-full resize-y rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-content-muted/70 focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </label>
          </div>

          <p className="mt-6 text-xs font-medium tracking-widest text-content-muted uppercase">
            {m.instructions.languageTitle}
          </p>
          <p className="mt-1.5 max-w-prose text-sm text-content-muted text-pretty">
            {m.instructions.languageBody}
          </p>

          <div
            role="radiogroup"
            aria-label={m.instructions.languageTitle}
            className="mt-4 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 lg:grid-cols-3"
          >
            {languages.map((lang) => {
              const selected = lang.key === language;
              return (
                <button
                  key={lang.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setLanguage(lang.key)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-accent bg-surface ring-1 ring-accent"
                      : "border-border-subtle bg-surface hover:border-border-strong hover:bg-surface-muted"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid size-7 shrink-0 place-items-center rounded-md text-[13px] leading-none font-semibold ${
                      selected
                        ? "bg-accent text-accent-contrast"
                        : "bg-surface-muted text-content-muted"
                    }`}
                  >
                    {lang.symbol}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {lang.displayName}
                    </span>
                    <span className="block text-xs text-content-muted">
                      {lang.promptName}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
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
