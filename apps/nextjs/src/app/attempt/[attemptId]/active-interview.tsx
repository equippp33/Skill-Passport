"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button, Card, CardContent, Progress } from "~/components/ui";
import { t } from "~/config/messages";
import type { Messages } from "~/config/messages";
import type { WorkSkillId } from "~/config/work-skills";
import { useAnswerRecorder } from "~/hooks/use-answer-recorder";
import { useLiveCaptions } from "~/hooks/use-live-captions";
import { useSpeechActivity } from "~/hooks/use-speech-activity";
import { uploadAnswerVideo } from "./upload-video";
import { LanguagePicker } from "./language-picker";
import type { PickableLanguage } from "./language-picker";
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
  SILENCE_ADVANCE_SECONDS,
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
  currentLanguage,
  m,
  languageCode,
}: {
  attemptId: string;
  totalTurns: number;
  initialTurn: TurnView | null;
  initialQuestionNumber: number;
  initialAttemptStatus: string;
  initialNeedsLanguage: boolean;
  /** Offered when detection is unusable, and in the picker as a backup. */
  languages: PickableLanguage[];
  /** Detected (or chosen) language key; null until the probe is scored. */
  currentLanguage: string | null;
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
  const playedForTurnRef = useRef<number | null>(null);
  const startRecordingFn = recorder.startRecording;
  const attachQuestion = recorder.attachQuestionAudio;
  const startQuestionCapture = recorder.startQuestionCapture;

  /**
   * Forget that this turn has already been played and recorded.
   *
   * Both guards are keyed by turn number, which is exactly right for moving
   * forwards and exactly wrong for staying put — a repeat has to clear them
   * or the question would sit there silently.
   */
  const allowReplay = useCallback(() => {
    autoStartedForTurnRef.current = null;
    playedForTurnRef.current = null;
  }, []);

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

  /* ------------------------------ recordings queue --------------------------- */

  /**
   * Webcam recordings, held in the browser until the interview is over.
   *
   * Nothing is uploaded between questions. A 1–2 MB upload starting the
   * moment an answer is submitted competes with the very requests the
   * candidate is waiting on, and on a modest connection that is the
   * difference between a pause and a stall. They all go up once, at the end,
   * when nothing else is happening.
   *
   * The trade is that these exist only in this tab until then: closing it
   * mid-interview loses the video. Transcripts, scores and the report do not
   * depend on them — they are written per turn, server side — so what is at
   * risk is the recording, never the assessment.
   */
  const pendingVideosRef = useRef<
    { turnNumber: number; video: Blob; durationMs: number }[]
  >([]);
  const [savingRecordings, setSavingRecordings] = useState(false);
  /** One flush at a time, or an interruption could upload a clip twice. */
  const flushingRef = useRef(false);

  /**
   * Send whatever is queued.
   *
   * `visible` distinguishes the two callers: the end-of-interview flush,
   * which the candidate is waiting on and should be told about, from a
   * salvage flush triggered by them leaving, where there is no one to show
   * a spinner to.
   *
   * A clip that fails goes back on the queue rather than being dropped, so
   * a blip mid-interview costs a retry rather than the recording.
   */
  const flushRecordings = useCallback(
    async (visible = true) => {
      if (flushingRef.current) return;
      const queued = pendingVideosRef.current.splice(0);
      if (queued.length === 0) return;

      flushingRef.current = true;
      if (visible) setSavingRecordings(true);
      try {
        // One at a time: several multi-megabyte uploads at once on a slow
        // link finish no sooner and are far more likely to time out.
        for (const item of queued) {
          const sent = await uploadAnswerVideo(
            attemptId,
            item.turnNumber,
            item.video,
            item.durationMs,
          );
          if (!sent) pendingVideosRef.current.push(item);
        }
      } finally {
        flushingRef.current = false;
        if (visible) setSavingRecordings(false);
      }
    },
    [attemptId],
  );

  /**
   * Salvage the recordings when the candidate goes away.
   *
   * Holding them until the end is the plan; losing them because a laptop
   * lid closed is not. `visibilitychange` fires while the page is still
   * alive and able to make requests, which is the last moment a
   * multi-megabyte upload can realistically start — `beforeunload` is too
   * late, and the 64KB cap on `keepalive` requests rules out finishing one
   * there. It is best-effort by nature: what completes, completes.
   */
  useEffect(() => {
    function salvage() {
      if (document.visibilityState !== "hidden") return;
      if (pendingVideosRef.current.length === 0) return;
      void flushRecordings(false);
    }
    document.addEventListener("visibilitychange", salvage);
    window.addEventListener("pagehide", salvage);
    return () => {
      document.removeEventListener("visibilitychange", salvage);
      window.removeEventListener("pagehide", salvage);
    };
  }, [flushRecordings]);

  /* ---------------------------- leave confirmation --------------------------- */

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Only nag when there is something to lose — which now includes
      // recordings still waiting to be uploaded.
      if (
        phase === "answering" &&
        !recorder.isRecording &&
        !recorder.hasRecording &&
        pendingVideosRef.current.length === 0
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
        // The recordings live only in this tab until now, and navigating
        // away would abort an upload in flight — so they go up first and
        // the candidate is told what the wait is for.
        await flushRecordings();
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
      if (data.needsLanguageChoice) {
        stopPolling();
        setPhase("answering");
        return;
      }

      // Same question, back to unanswered: the candidate asked to hear it
      // again, so play it and start listening rather than waiting for a
      // next question that is not coming.
      if (
        data.turn &&
        data.turn.turnNumber === questionNumber &&
        data.turn.status === "awaiting_answer"
      ) {
        stopPolling();
        setTurn(data.turn);
        setError(null);
        resetRecorder();
        allowReplay();
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
        allowReplay();
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
        // Whatever is recorded is worth keeping even though this turn
        // failed — do not sit on it waiting for an end that may not come.
        void flushRecordings(false);
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
    flushRecordings,
    allowReplay,
  ]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollStartedAtRef.current = Date.now();
    scheduleNextPoll();
  }, [scheduleNextPoll, stopPolling]);

  /**
   * Polling is owned entirely by the phase.
   *
   * It used to be started by hand inside `submitAnswer` as well, and this
   * effect's cleanup then ran on the very next render and cleared the timer
   * that had just been set — without nulling the ref, so the
   * `!pollTimerRef.current` guard blocked it from ever restarting. The
   * interview sat on "Processing your answer…" until the page was reloaded.
   *
   * Driving it from one place removes the race: entering `processing` starts
   * it, leaving `processing` stops it, and `startPolling` clears any previous
   * timer so running twice is harmless.
   */
  useEffect(() => {
    if (phase !== "processing") return;
    startPolling();
    return stopPolling;
  }, [phase, startPolling, stopPolling]);

  // Never leave a timer running after the screen goes away.
  useEffect(() => stopPolling, [stopPolling]);

  /* -------------------------------- submitting ------------------------------- */

  const submitAnswer = useCallback(
    async (segments: Blob[], video: Blob | null, durationMs: number) => {
      if (submittingRef.current) return;
      if (!turn) return;

      submittingRef.current = true;
      setPhase("submitting");
      setError(null);

      try {
        // One part per segment, in order. A long answer arrives as several
        // files because the transcriber will not take more than 30 seconds
        // in one go — see AUDIO_SEGMENT_SECONDS.
        const form = new FormData();
        segments.forEach((segment, index) => {
          const extension = segment.type.includes("mp4") ? "m4a" : "webm";
          form.append("audio", segment, `answer-${index}.${extension}`);
        });
        form.append("turnNumber", String(turn.turnNumber));
        form.append("durationMs", String(durationMs));

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

        // Held back rather than uploaded now — see `pendingVideosRef`.
        if (video && video.size > 0) {
          pendingVideosRef.current.push({
            turnNumber: turn.turnNumber,
            video,
            durationMs,
          });
        }

        // Polling begins from the phase effect, not here — see the note
        // on that effect.
        setPhase("processing");
      } catch {
        setError(genericError);
        setPhase("error");
      } finally {
        submittingRef.current = false;
      }
    },
    [turn, attemptId, router, genericError],
  );

  /**
   * The single control the candidate uses: stop recording and send.
   *
   * `stopRecording()` resolves with the finished blobs, so there is no review
   * step and no window in which a half-flushed recording could be submitted.
   */
  const handleNext = useCallback(async () => {
    if (submittingRef.current) return;
    const { audioSegments, video, durationMs } = await recorder.stopRecording();

    // Judged on the whole answer, not the last segment: a reply that rolls
    // over at 25s can leave a final fragment far below this on its own.
    const recorded = audioSegments.reduce((sum, part) => sum + part.size, 0);
    if (recorded < MIN_ANSWER_BLOB_BYTES) {
      setError(m.interview.tooShort);
      setPhase("error");
      return;
    }
    await submitAnswer(audioSegments, video, durationMs);
  }, [recorder, submitAnswer, m.interview.tooShort]);

  /* ---------------------------- finished speaking ---------------------------- */

  /**
   * Move on by itself once the candidate stops talking.
   *
   * A real interviewer does not wait to be told an answer is over, and
   * asking someone to press a button after every reply is the part of this
   * that felt least like an interview. Next is still there for anyone who
   * wants it, and the countdown resets the moment they speak again.
   */
  const speech = useSpeechActivity({
    stream: recorder.stream,
    active: recorder.isRecording && !isBusy,
    silenceSeconds: SILENCE_ADVANCE_SECONDS,
    minSpeechSeconds: MIN_ANSWER_SECONDS,
    onSilence: () => void handleNext(),
  });

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
  const turnNumber = turn?.turnNumber ?? null;

  useEffect(() => {
    if (phase !== "answering" || turnNumber === null) return;
    // Exactly once per question. Re-entering this effect for any other
    // reason must never restart the audio: calling `play()` on an element
    // that has already ended plays the question again, over the candidate's
    // answer, and the microphone records it.
    if (playedForTurnRef.current === turnNumber) return;
    playedForTurnRef.current = turnNumber;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const el = audioRef.current;

    // Route the player through the recorder's mixer and start the webcam
    // BEFORE the question is spoken, so the clip an admin watches contains
    // the question as well as the answer. Both are best-effort: neither
    // failing stops the question from playing.
    attachQuestion(el);
    startQuestionCapture();

    if (el && turnRef.current?.questionAudioId) {
      el.currentTime = 0;
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
  }, [turnNumber, phase, beginAnswer, attachQuestion, startQuestionCapture]);

  async function handleRetryAudio() {
    if (!turn) return;
    setRetryingAudio(true);
    const result = await retryQuestionAudioAction(attemptId, turn.turnNumber);
    setRetryingAudio(false);
    if (result.ok) router.refresh();
    else setAudioError(true);
  }

  /**
   * "Record again" after a failed turn.
   *
   * Has to put the turn back to how it looked before the candidate spoke,
   * not just clear the message. The recorder is sitting in its finished
   * state and both once-per-turn guards have already fired, so without
   * resetting them the question never replays, recording never restarts,
   * and Next stays disabled behind `canFinish` — a dead end with "Getting
   * ready…" underneath it, which is exactly what this button was leaving
   * behind.
   */
  function handleRetrySubmit() {
    setError(null);
    resetRecorder();
    allowReplay();
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

            {/* A grid rather than the dropdown used mid-interview: here
                choosing is the only thing on screen, so every option should
                be visible at once instead of behind a click. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {languages.map((lang) => (
                <button
                  key={lang.key}
                  type="button"
                  onClick={() => void pickLanguage(lang.key)}
                  disabled={choosingLanguage}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-muted text-[13px] leading-none font-semibold text-content-muted"
                  >
                    {lang.symbol}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {lang.displayName}
                    </span>
                    <span className="block truncate text-xs text-content-muted">
                      {lang.promptName}
                    </span>
                  </span>
                </button>
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
      {/* Backup for automatic detection. Kept at the very top so a candidate
          being interviewed in the wrong language can fix it immediately,
          without hunting for the control while a timer runs. */}
      <div className="flex justify-end">
        <LanguagePicker
          languages={languages}
          value={currentLanguage}
          onSelect={(key) => void pickLanguage(key)}
          busy={choosingLanguage}
          disabled={isBusy}
          label={m.interview.languageLabel}
          hint={m.interview.languageHint}
        />
      </div>

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
                  // Second attempt at starting the webcam. On the first
                  // question the media stream can still be resolving when
                  // the effect above runs, and by playback it is ready.
                  // Idempotent, so this is free when it already started.
                  onPlay={startQuestionCapture}
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
                {savingRecordings
                  ? m.interview.savingRecordings
                  : phase === "processing"
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

          {/* The interview moves on by itself when the candidate stops
              talking; this is here for anyone who would rather not wait. */}
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

            {speech.secondsRemaining !== null && !isBusy ? (
              <p className="text-sm font-medium text-accent" aria-live="polite">
                {t(m.interview.advancingIn, {
                  seconds: speech.secondsRemaining,
                })}
              </p>
            ) : !canFinish && !isBusy ? (
              <p className="text-sm text-content-muted">
                {recorder.isRecording
                  ? m.interview.keepSpeaking
                  : m.interview.preparing}
              </p>
            ) : null}
          </div>

          {savingRecordings ? (
            <p className="text-sm text-content-muted" aria-live="polite">
              {m.interview.savingRecordings}
            </p>
          ) : phase === "processing" ? (
            <p className="text-sm text-content-muted">
              {m.interview.processingHint}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
