"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button, Card, CardContent, Progress } from "~/components/ui";
import { t } from "~/config/messages";
import type { Messages } from "~/config/messages";
import type { WorkSkillId } from "~/config/work-skills";
import { useAnswerRecorder } from "~/hooks/use-answer-recorder";
import { useLiveCaptions } from "~/hooks/use-live-captions";
import { uploadAnswerVideo } from "./upload-video";
import { preventCapture, useCaptureDeterrent } from "./capture-guard";
import {
  chooseLanguageAction,
  retryQuestionAudioAction,
} from "~/server/attempt/actions";
import { formatDuration } from "~/lib/utils";
import {
  ANSWER_WARN_SECONDS,
  MAX_ANSWER_SECONDS,
  MIN_ANSWER_BLOB_BYTES,
  AUTO_START_BACKSTOP_MS,
  MIN_ANSWER_SECONDS,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
} from "./constants";

interface TurnView {
  turnNumber: number;
  question: string;
  questionAudioId: string | null;
  status: "awaiting_answer" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  skillId: WorkSkillId | null;
  kind: "language_probe" | "skill";
  questionTranslation: string | null;
}

interface StatusResponse {
  attemptStatus: string;
  lastTranscript: string | null;
  currentQuestionNumber: number;
  totalTurns: number;
  needsLanguageChoice: boolean;
  language: string | null;
  turn: TurnView | null;
  isComplete: boolean;
}

type Phase = "answering" | "submitting" | "processing" | "error";

export function ActiveInterview({
  attemptId,
  totalTurns,
  initialTurn,
  initialQuestionNumber,
  initialAttemptStatus,
  initialNeedsLanguage,
  languages,
  m,
  languageCode,
}: {
  attemptId: string;
  totalTurns: number;
  initialTurn: TurnView | null;
  initialQuestionNumber: number;
  initialAttemptStatus: string;
  initialNeedsLanguage: boolean;
  /** Offered when detection is unusable — never guessed at. */
  languages: { key: string; displayName: string; promptName: string }[];
  m: Messages;
  /** BCP-47 code of the session language, for correct text rendering. */
  languageCode: string;
}) {
  const router = useRouter();

  const [turn, setTurn] = useState<TurnView | null>(initialTurn);
  const [questionNumber, setQuestionNumber] = useState(initialQuestionNumber);
  const [phase, setPhase] = useState<Phase>(
    initialAttemptStatus === "processing" ||
      initialTurn?.status === "processing"
      ? "processing"
      : "answering",
  );
  const [error, setError] = useState<string | null>(
    initialTurn?.status === "failed" ? initialTurn.errorMessage : null,
  );
  const [audioError, setAudioError] = useState(false);
  /** How often the candidate left the tab. Shown to them as a nudge. */
  const [awayCount, setAwayCount] = useState(0);
  /** Set when detection failed and the candidate must pick a language. */
  const [needsLanguage, setNeedsLanguage] = useState(initialNeedsLanguage);
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  /** Sarvam's transcript of the previous answer — the authoritative one. */
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [retryingAudio, setRetryingAudio] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Latest turn, read by callbacks that must not re-create on every change. */
  const turnRef = useRef<TurnView | null>(initialTurn);
  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartedAtRef = useRef<number | null>(null);
  /** Guards against a double submit from a fast double-click. */
  const submittingRef = useRef(false);

  const recorder = useAnswerRecorder({
    maxSeconds: MAX_ANSWER_SECONDS,
    withVideo: true,
  });

  // Live camera feed. Attached imperatively because a MediaStream cannot be
  // passed through the `src` attribute.
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = previewVideoRef.current;
    if (!el) return;
    el.srcObject = recorder.previewStream;
  }, [recorder.previewStream]);

  const isBusy = phase === "submitting" || phase === "processing";

  // Display-only captions from the browser. The stored transcript is
  // Sarvam's, produced after the answer is submitted.
  const captions = useLiveCaptions({
    active: recorder.isRecording,
    languageCode,
  });
  /** Guard against an empty answer from an accidental early click. */
  const canFinish =
    recorder.isRecording && recorder.elapsedSeconds >= MIN_ANSWER_SECONDS;
  const isLastQuestion = (turn?.turnNumber ?? 0) >= totalTurns;

  /* --------------------------- devices + auto-start -------------------------- */

  const acquireDevices = recorder.requestPermission;
  const releaseDevices = recorder.release;

  /**
   * Turn the camera and microphone on as soon as the interview screen opens
   * and keep them on until it closes. Permission was already granted during
   * the device check, so this does not prompt again.
   */
  useEffect(() => {
    let cancelled = false;
    void acquireDevices().then((result) => {
      if (cancelled && result.granted) releaseDevices();
    });
    return () => {
      cancelled = true;
      releaseDevices();
    };
  }, [acquireDevices, releaseDevices]);

  /**
   * Start recording once per question, after the question audio has finished
   * playing so the interviewer's voice is not captured in the answer.
   */
  const autoStartedForTurnRef = useRef<number | null>(null);
  const startRecordingFn = recorder.startRecording;

  const beginAnswer = useCallback(() => {
    const current = turnRef.current;
    if (!current) return;
    if (autoStartedForTurnRef.current === current.turnNumber) return;
    autoStartedForTurnRef.current = current.turnNumber;
    void startRecordingFn();
  }, [startRecordingFn]);

  /* ------------------------------ capture guard ------------------------------ */

  const noteLeftTab = useCallback(() => {
    setAwayCount((n) => n + 1);
    // Recorded server-side too, so it survives a refresh and reaches the admin.
    void fetch(`/api/attempt/${attemptId}/away`, { method: "POST" }).catch(
      () => undefined,
    );
  }, [attemptId]);
  useCaptureDeterrent({
    enabled: phase !== "processing",
    onLeave: noteLeftTab,
  });

  /* ---------------------------- leave confirmation --------------------------- */

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Only nag when there is something to lose.
      if (
        phase === "answering" &&
        !recorder.isRecording &&
        !recorder.hasRecording
      ) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase, recorder.isRecording, recorder.hasRecording]);

  /* --------------------------------- polling -------------------------------- */

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollStartedAtRef.current = null;
  }, []);

  /**
   * The poll loop reschedules itself. It calls through this ref rather than
   * closing over itself, so each tick runs the latest callback instead of a
   * stale closure.
   */
  const pollRef = useRef<() => void>(() => undefined);
  const scheduleNextPoll = useCallback(() => {
    pollTimerRef.current = setTimeout(
      () => pollRef.current(),
      POLL_INTERVAL_MS,
    );
  }, []);

  const resetRecorder = recorder.reset;
  // Hoisted so the poll/submit callbacks depend on a stable string rather
  // than the whole messages object.
  const genericError = m.errors.generic;

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/attempt/${attemptId}/status`, {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.push(`/i`);
        return;
      }
      if (!response.ok) throw new Error("status request failed");

      const data = (await response.json()) as StatusResponse;

      if (data.isComplete) {
        stopPolling();
        router.replace(`/attempt/${attemptId}/result`);
        return;
      }

      if (data.turn?.status === "failed") {
        stopPolling();
        setTurn(data.turn);
        setError(data.turn.errorMessage ?? genericError);
        setPhase("error");
        return;
      }

      setNeedsLanguage(data.needsLanguageChoice);
      if (data.lastTranscript) setLastTranscript(data.lastTranscript);
      if (data.needsLanguageChoice) {
        stopPolling();
        setPhase("answering");
        return;
      }

      // A new question means the previous turn finished successfully.
      if (data.turn && data.currentQuestionNumber > questionNumber) {
        stopPolling();
        setTurn(data.turn);
        setQuestionNumber(data.currentQuestionNumber);
        setAudioError(false);
        setError(null);
        resetRecorder();
        setPhase("answering");
        return;
      }

      if (
        pollStartedAtRef.current &&
        Date.now() - pollStartedAtRef.current > POLL_TIMEOUT_MS
      ) {
        stopPolling();
        setError(genericError);
        setPhase("error");
        return;
      }

      scheduleNextPoll();
    } catch {
      if (
        pollStartedAtRef.current &&
        Date.now() - pollStartedAtRef.current > POLL_TIMEOUT_MS
      ) {
        stopPolling();
        setError(genericError);
        setPhase("error");
        return;
      }
      // Transient network blip — keep polling.
      scheduleNextPoll();
    }
  }, [
    attemptId,
    questionNumber,
    router,
    stopPolling,
    scheduleNextPoll,
    resetRecorder,
    genericError,
  ]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollStartedAtRef.current = Date.now();
    scheduleNextPoll();
  }, [scheduleNextPoll, stopPolling]);

  // Resume polling if the page was reloaded mid-processing.
  useEffect(() => {
    if (phase === "processing" && !pollTimerRef.current) startPolling();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* -------------------------------- submitting ------------------------------- */

  const submitAnswer = useCallback(
    async (audio: Blob, video: Blob | null) => {
      if (submittingRef.current) return;
      if (!turn) return;

      submittingRef.current = true;
      setPhase("submitting");
      setError(null);

      try {
        const form = new FormData();
        const extension = audio.type.includes("mp4") ? "m4a" : "webm";
        form.append("audio", audio, `answer.${extension}`);
        form.append("turnNumber", String(turn.turnNumber));

        const response = await fetch(`/api/attempt/${attemptId}/answer`, {
          method: "POST",
          body: form,
        });

        if (response.status === 401) {
          router.push(`/i`);
          return;
        }

        if (!response.ok && response.status !== 202) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? genericError);
          setPhase("error");
          return;
        }

        // Audio is accepted; the interview can proceed. The webcam file is
        // uploaded in the background and never blocks the candidate.
        if (video && video.size > 0) {
          void uploadAnswerVideo(attemptId, turn.turnNumber, video);
        }

        setPhase("processing");
        startPolling();
      } catch {
        setError(genericError);
        setPhase("error");
      } finally {
        submittingRef.current = false;
      }
    },
    [turn, attemptId, router, startPolling, genericError],
  );

  /**
   * The single control the candidate uses: stop recording and send.
   *
   * `stopRecording()` resolves with the finished blobs, so there is no review
   * step and no window in which a half-flushed recording could be submitted.
   */
  const handleNext = useCallback(async () => {
    if (submittingRef.current) return;
    const { audio, video } = await recorder.stopRecording();

    if (!audio || audio.size < MIN_ANSWER_BLOB_BYTES) {
      setError(m.interview.tooShort);
      setPhase("error");
      return;
    }
    await submitAnswer(audio, video);
  }, [recorder, submitAnswer, m.interview.tooShort]);

  /* ------------------------------ question audio ----------------------------- */

  const playQuestion = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => setAudioError(true));
  }, []);

  /**
   * Play the question when it arrives, then hand over to `beginAnswer`.
   *
   * Autoplay can be blocked without a prior gesture, and a question can have
   * no audio at all if TTS failed — both fall through to a short timer so the
   * candidate is never left with a question and no recording running.
   */
  useEffect(() => {
    if (phase !== "answering" || !turn) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const el = audioRef.current;

    if (turn.questionAudioId && el) {
      void el.play().catch(() => {
        timer = setTimeout(beginAnswer, 400);
      });
    } else {
      timer = setTimeout(beginAnswer, 800);
    }

    // Last-resort backstop. `beginAnswer` is idempotent per turn, so if
    // `ended` did fire this does nothing — but if the audio stalls or the
    // event is missed, the candidate still gets to answer.
    const backstop = setTimeout(beginAnswer, AUTO_START_BACKSTOP_MS);

    return () => {
      if (timer) clearTimeout(timer);
      clearTimeout(backstop);
    };
  }, [turn, phase, beginAnswer]);

  async function handleRetryAudio() {
    if (!turn) return;
    setRetryingAudio(true);
    const result = await retryQuestionAudioAction(attemptId, turn.turnNumber);
    setRetryingAudio(false);
    if (result.ok) router.refresh();
    else setAudioError(true);
  }

  function handleRetrySubmit() {
    setError(null);
    setPhase("answering");
  }

  /* ---------------------------------- render --------------------------------- */

  /* --------------------------- language selection -------------------------- */

  async function pickLanguage(key: string) {
    setChoosingLanguage(true);
    const result = await chooseLanguageAction(attemptId, key);
    setChoosingLanguage(false);
    if (result.ok) {
      setNeedsLanguage(false);
      router.refresh();
    } else {
      setError(result.error ?? genericError);
    }
  }

  // Detection was unusable, so ask rather than conduct a whole interview in a
  // language the candidate may not speak.
  if (needsLanguage) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h1 className="text-lg font-medium">
                {m.interview.chooseLanguageTitle}
              </h1>
              <p className="mt-1 text-sm text-content-muted">
                {m.interview.chooseLanguageBody}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {languages.map((lang) => (
                <Button
                  key={lang.key}
                  variant="secondary"
                  onClick={() => void pickLanguage(lang.key)}
                  disabled={choosingLanguage}
                >
                  {lang.displayName}
                </Button>
              ))}
            </div>

            {error ? <Alert tone="danger">{error}</Alert> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!turn) {
    return (
      <Alert tone="danger" title={m.interview.unavailableTitle}>
        {m.interview.unavailableBody}
      </Alert>
    );
  }

  const nearLimit = recorder.elapsedSeconds >= ANSWER_WARN_SECONDS;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-content-muted">
            {t(m.interview.questionProgress, {
              current: turn.turnNumber,
              total: totalTurns,
            })}
          </p>
          <p className="text-sm text-content-muted tabular-nums">
            {Math.round((turn.turnNumber / totalTurns) * 100)}%
          </p>
        </div>
        <div className="mt-2">
          <Progress
            value={turn.turnNumber}
            max={totalTurns}
            label={t(m.interview.questionProgress, {
              current: turn.turnNumber,
              total: totalTurns,
            })}
          />
        </div>
      </div>

      {/* Selection, copy and context menu are blocked on the question so it
          cannot be trivially pasted elsewhere. This is a deterrent only —
          see the note on `useCaptureDeterrent`. */}
      <Card
        onCopy={preventCapture}
        onCut={preventCapture}
        onContextMenu={preventCapture}
        onDragStart={preventCapture}
        className="select-none"
      >
        <CardContent className="space-y-4 pt-5">
          {turn.skillId ? (
            <p className="text-xs font-medium tracking-wide text-content-muted uppercase">
              {t(m.interview.assessing, { skill: m.skills[turn.skillId] })}
            </p>
          ) : (
            <p className="text-xs font-medium tracking-wide text-content-muted uppercase">
              {m.interview.introduction}
            </p>
          )}

          <h1
            className="text-lg leading-relaxed font-medium"
            aria-live="polite"
            lang={languageCode}
          >
            {turn.question}
          </h1>

          {/* English rendering, for reviewers who do not read the interview
              language. Absent when the interview is already in English. */}
          {turn.questionTranslation ? (
            <p
              className="border-l-2 border-border-strong pl-3 text-sm leading-relaxed text-content-muted"
              lang="en"
            >
              {turn.questionTranslation}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {turn.questionAudioId ? (
              <>
                <audio
                  ref={audioRef}
                  src={`/api/media/${turn.questionAudioId}?attempt=${attemptId}`}
                  // Recording starts when the question finishes playing.
                  // Without this the candidate is left on "getting ready".
                  onEnded={beginAnswer}
                  onError={() => {
                    setAudioError(true);
                    // Broken audio must not strand them either.
                    beginAnswer();
                  }}
                  preload="auto"
                  className="hidden"
                />
                <Button variant="secondary" size="sm" onClick={playQuestion}>
                  {m.interview.playQuestion}
                </Button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-content-muted">
                  {m.interview.audioUnavailable}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRetryAudio}
                  disabled={retryingAudio}
                >
                  {retryingAudio
                    ? m.interview.generatingAudio
                    : m.interview.retryAudio}
                </Button>
              </div>
            )}
          </div>

          {audioError ? (
            <p className="text-sm text-content-muted">
              {m.interview.audioFailed}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {awayCount > 0 ? (
        <Alert tone="warning">
          {t(m.interview.leftTab, { count: awayCount })}
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="danger" title={m.interview.errorTitle}>
          <p>{error}</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={handleRetrySubmit}>
              {m.interview.recordAgain}
            </Button>
          </div>
        </Alert>
      ) : null}

      {recorder.errorMessage ? (
        <Alert tone="danger" title={m.interview.micProblemTitle}>
          {recorder.errorMessage}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4 pt-5">
          {/* Recording status, announced to assistive tech. */}
          <div
            className="flex items-center justify-between gap-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={
                  recorder.isRecording
                    ? "size-2.5 shrink-0 animate-pulse rounded-full bg-danger"
                    : "size-2.5 shrink-0 rounded-full bg-border-subtle"
                }
              />
              <span className="text-sm font-medium">
                {phase === "processing"
                  ? m.interview.processingStatus
                  : phase === "submitting"
                    ? m.interview.uploading
                    : recorder.isRecording
                      ? m.interview.recording
                      : recorder.hasRecording
                        ? m.interview.recorded
                        : m.interview.ready}
              </span>
            </div>

            <span
              className={
                nearLimit && recorder.isRecording
                  ? "text-sm font-medium text-danger tabular-nums"
                  : "text-sm text-content-muted tabular-nums"
              }
            >
              {formatDuration(recorder.elapsedSeconds)} /{" "}
              {formatDuration(MAX_ANSWER_SECONDS)}
            </span>
          </div>

          {recorder.isRecording ? (
            <Progress
              value={recorder.elapsedSeconds}
              max={MAX_ANSWER_SECONDS}
              label={m.interview.recording}
            />
          ) : null}

          {recorder.isRecording && captions.supported ? (
            <div
              className="rounded-lg border border-border-subtle bg-surface-muted px-3 py-2.5"
              aria-live="polite"
            >
              <p className="text-xs font-medium tracking-wide text-content-muted uppercase">
                {m.interview.liveCaptions}
              </p>
              <p className="mt-1 text-sm leading-relaxed" lang={languageCode}>
                {captions.text || m.interview.listening}
              </p>
            </div>
          ) : null}

          {recorder.previewStream ? (
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-content/90">
              {/* Mirrored so it reads like a mirror, muted to avoid feedback. */}
              <video
                ref={previewVideoRef}
                autoPlay
                muted
                playsInline
                aria-label="Your camera"
                className="aspect-video w-full -scale-x-100 object-cover"
              />
            </div>
          ) : null}

          {/* One control. Recording starts on its own once the question has
              been read out, so the candidate only has to say when they are
              done — the same as a real interview. */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => void handleNext()}
              disabled={isBusy || !canFinish}
            >
              {phase === "submitting"
                ? m.interview.submitting
                : isLastQuestion
                  ? m.interview.finish
                  : m.interview.next}
            </Button>

            {!canFinish && !isBusy ? (
              <p className="text-sm text-content-muted">
                {recorder.isRecording
                  ? m.interview.keepSpeaking
                  : m.interview.preparing}
              </p>
            ) : null}
          </div>

          {phase === "processing" ? (
            <p className="text-sm text-content-muted">
              {m.interview.processingHint}
            </p>
          ) : null}

          {/* What Sarvam actually heard last time — this is what was stored
              and scored, so showing it lets the candidate correct course. */}
          {lastTranscript && !recorder.isRecording ? (
            <div className="rounded-lg bg-surface-muted px-3 py-2.5">
              <p className="text-xs font-medium text-content-muted">
                {m.interview.previousTranscript}
              </p>
              <p
                className="mt-1 text-sm leading-relaxed whitespace-pre-wrap"
                lang={languageCode}
              >
                {lastTranscript}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
