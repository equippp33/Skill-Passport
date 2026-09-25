"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button, Progress } from "~/components/ui";
import { CameraPreview } from "~/components/camera-preview";
import { VoiceOrb } from "~/components/voice-orb";
import type { OrbState } from "~/components/voice-orb";
import { Waveform } from "./waveform";
import { t } from "~/config/messages";
import type { Messages } from "~/config/messages";
import type { WorkSkillId } from "~/config/work-skills";
import { useAnswerRecorder } from "~/hooks/use-answer-recorder";
import { useSpeechActivity } from "~/hooks/use-speech-activity";
import { useFullscreen } from "~/hooks/use-fullscreen";
import { useTypewriter } from "~/hooks/use-typewriter";
import { uploadAnswerVideo } from "./upload-video";
import { preventCapture, useCaptureDeterrent } from "./capture-guard";
import {
  retryQuestionAudioAction,
  skipTurnAction,
} from "~/server/attempt/actions";
import { env } from "~/env";
import { useStreamingStt } from "~/hooks/use-streaming-stt";
import {
  MAX_ANSWER_SECONDS,
  MIN_ANSWER_BLOB_BYTES,
  AUTO_START_BACKSTOP_MS,
  MIN_ANSWER_SECONDS,
  NO_ANSWER_STAGES,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  SILENCE_ADVANCE_SECONDS,
  SILENCE_WARN_SECONDS,
  SILENCE_SKIP_SECONDS,
  ADD_WAIT_MS,
  ADD_DECLINE_MAX_WORDS,
  ADD_MAX_ANSWER_MS,
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
  totalSkills: number;
  skillNumber: number;
  turn: TurnView | null;
  isComplete: boolean;
  nextQuestionAudioId: string | null;
}

type Phase = "answering" | "submitting" | "processing" | "error";

export function ActiveInterview({
  attemptId,
  totalSkills,
  initialSkillNumber,
  initialTurn,
  initialQuestionNumber,
  initialAttemptStatus,
  fillerUrls,
  checkUrl,
  addUrl,
  m,
  languageCode,
}: {
  attemptId: string;
  /** Assessable skills — the progress denominator. */
  totalSkills: number;
  /** Which skill the opening turn belongs to (1..totalSkills), 0 on the probe. */
  initialSkillNumber: number;
  initialTurn: TurnView | null;
  initialQuestionNumber: number;
  initialAttemptStatus: string;
  /** Rotating filler clips, one played the instant an answer is sent. */
  fillerUrls: string[];
  /** "Did you understand the question?" check-in, played after a long silence. */
  checkUrl: string;
  /** "Would you like to add anything?" prompt, played on the first answer pause. */
  addUrl: string;
  m: Messages;
  /** BCP-47 code of the session language, for correct text rendering. */
  languageCode: string;
}) {
  const router = useRouter();

  const [turn, setTurn] = useState<TurnView | null>(initialTurn);
  const [questionNumber, setQuestionNumber] = useState(initialQuestionNumber);
  // Progress is by skill, not turn: a follow-up keeps the same skill number.
  const [skillNumber, setSkillNumber] = useState(Math.max(1, initialSkillNumber));
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
  const [retryingAudio, setRetryingAudio] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** One filler element whose src is swapped to a random variant each turn, so
   *  it never sounds like a recording and never fights the question audio. The
   *  variants are pre-warmed into the browser cache so the swap plays instantly. */
  const fillerRef = useRef<HTMLAudioElement | null>(null);
  const lastFillerRef = useRef(-1);
  useEffect(() => {
    for (const url of fillerUrls) {
      const warm = new Audio();
      warm.preload = "auto";
      warm.src = url;
    }
  }, [fillerUrls]);
  const playFiller = useCallback(() => {
    const el = fillerRef.current;
    const count = fillerUrls.length;
    if (!el || count === 0) return;
    // Pick a variant different from the last one played.
    let idx = Math.floor(Math.random() * count);
    if (count > 1 && idx === lastFillerRef.current) idx = (idx + 1) % count;
    lastFillerRef.current = idx;
    try {
      el.src = fillerUrls[idx]!;
      el.currentTime = 0;
      void el.play().catch(() => undefined);
    } catch {
      // Best-effort — a blocked filler just means the old silent gap.
    }
  }, [fillerUrls]);
  const stopFiller = useCallback(() => {
    const el = fillerRef.current;
    if (el && !el.paused) el.pause();
  }, []);

  /** The whole interview is a fullscreen stage; a gate nudges them back in. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { isFullscreen, request: requestFullscreen } = useFullscreen(stageRef);
  /** True while the interviewer is speaking (question or filler) — the blob. */
  const [speaking, setSpeaking] = useState(false);
  /** Latest turn, read by callbacks that must not re-create on every change. */
  const turnRef = useRef<TurnView | null>(initialTurn);
  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartedAtRef = useRef<number | null>(null);
  /** Guards against a double submit from a fast double-click. */
  const submittingRef = useRef(false);
  /**
   * The turn already sent. Blocks a SECOND submit of the same answer after the
   * first has finished — the silence hook and the max-duration backstop can
   * both fire, and on mobile a stale recorder event can too. Cleared when a
   * new question arrives (see `allowReplay`).
   */
  const submittedTurnRef = useRef<number | null>(null);

  /**
   * Perception timers (dev instrumentation).
   *
   * The two waits candidates actually feel: from a question appearing to its
   * voice starting (the bad-internet "text is there, audio isn't" gap), and
   * from finishing an answer to the next question showing. Logged to the
   * browser console as `[timing] client.*` so the client legs sit next to the
   * server ones. ponytail: console-only; delete the marks once tuned.
   */
  const questionShownAtRef = useRef(0);
  const answerEndedAtRef = useRef(0);

  // The answer is submitted automatically — when the candidate pauses (see the
  // speech-activity hook below) or, as a backstop, when the recording hits its
  // hard time cap. There is no manual "next" button, so this callback is what
  // guarantees a very long answer still gets sent.
  const submitCurrentAnswerRef = useRef<() => void>(() => undefined);
  const recorder = useAnswerRecorder({
    maxSeconds: MAX_ANSWER_SECONDS,
    withVideo: true,
    onMaxDurationReached: () => submitCurrentAnswerRef.current(),
  });

  const isBusy = phase === "submitting" || phase === "processing";

  /* ------------------------------ streaming STT ------------------------------ */

  // Realtime STT (mic → relay → Sarvam) replaces local mic-VAD and batch
  // transcription when enabled. If the relay connection fails, we fall back to
  // the record-then-transcribe path for the rest of the interview so a bad
  // relay never strands the candidate.
  const relayUrl = env.NEXT_PUBLIC_STT_RELAY_URL ?? "";
  const [streamFailed, setStreamFailed] = useState(false);
  const streamingOn =
    env.NEXT_PUBLIC_STT_STREAMING === "1" && !!relayUrl && !streamFailed;

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
  const startQuestionCapture = recorder.startQuestionCapture;
  const playIntoRecording = recorder.playIntoRecording;

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
    submittedTurnRef.current = null;
  }, []);

  const beginAnswer = useCallback(() => {
    const current = turnRef.current;
    if (!current) return;
    if (autoStartedForTurnRef.current === current.turnNumber) return;
    autoStartedForTurnRef.current = current.turnNumber;
    void startRecordingFn();
  }, [startRecordingFn]);

  /* ------------------------------ capture guard ------------------------------ */

  /**
   * Leaving the tab is recorded for the admin, and no longer shown to the
   * candidate. The warning it used to raise accused someone of cheating for
   * an alt-tab or a notification, mid-interview, when they could do nothing
   * about it — which unsettles an honest candidate and does not stop a
   * dishonest one.
   */
  const noteLeftTab = useCallback(() => {
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

  /** Leave for the results now, abandoning any recordings still uploading. */
  const goToResult = useCallback(() => {
    stopPolling();
    router.replace(`/attempt/${attemptId}/result`);
  }, [stopPolling, router, attemptId]);

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

  /**
   * Clips already pulled into cache, so a repeated poll does not refetch.
   * Holds the element too: a bare `new Audio()` can be collected before the
   * download finishes, which would quietly defeat the whole point.
   */
  const warmedAudioRef = useRef(new Map<string, HTMLAudioElement>());

  const warmNextQuestionAudio = useCallback(
    (audioId: string | null) => {
      if (!audioId || warmedAudioRef.current.has(audioId)) return;
      try {
        const warm = new Audio();
        warm.preload = "auto";
        warm.src = `/api/media/${audioId}?attempt=${attemptId}`;
        warm.load();
        warmedAudioRef.current.set(audioId, warm);
      } catch {
        // Warming is an optimisation; the question still plays without it.
      }
    },
    [attemptId],
  );

  const resetRecorder = recorder.reset;
  // Hoisted so the poll/submit callbacks depend on a stable string rather
  // than the whole messages object.
  const genericError = m.errors.generic;

  // "Add anything?" ask-state: whether we've offered on the current answer, the
  // answer stashed before the offer, and the fallback silence timer. `poll`
  // resets these when a turn (re)arms so each answer starts fresh; the offer
  // logic itself lives with the streaming handler below.
  const addAskedRef = useRef(false);
  const pendingAnswerRef = useRef("");
  const addTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the candidate first and last had partial speech on THIS answer — the
  // span between them is how long they actually spoke, used to skip the "add?"
  // offer on answers that were already long enough.
  const speechStartRef = useRef<number | null>(null);
  const speechEndRef = useRef<number | null>(null);

  const clearAddTimer = useCallback(() => {
    if (addTimerRef.current) {
      clearTimeout(addTimerRef.current);
      addTimerRef.current = null;
    }
  }, []);

  const resetAddState = useCallback(() => {
    addAskedRef.current = false;
    pendingAnswerRef.current = "";
    speechStartRef.current = null;
    speechEndRef.current = null;
    clearAddTimer();
  }, [clearAddTimer]);

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
        // Upload the held recordings, but never trap the candidate here: go to
        // the results after a short cap whatever happens, and the "See your
        // results" button (shown while saving) lets them skip immediately. The
        // assessment is already scored server-side; the video is best-effort.
        await Promise.race([
          flushRecordings(),
          new Promise((resolve) => setTimeout(resolve, 10_000)),
        ]);
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

      // Pull the next question's audio into the browser cache while the
      // candidate is still answering this one. Without this the download
      // starts at the moment the question appears, and they sit through it.
      warmNextQuestionAudio(data.nextQuestionAudioId);

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
        // Give streaming a fresh chance on this turn — a transient failure on
        // the previous turn should not force batch for the rest of the interview.
        setStreamFailed(false);
        resetRecorder();
        resetAddState();
        allowReplay();
        setPhase("answering");
        return;
      }

      // A new question means the previous turn finished successfully.
      if (data.turn && data.currentQuestionNumber > questionNumber) {
        if (answerEndedAtRef.current) {
          console.log(
            `[timing] client.answer→next ${Math.round(
              performance.now() - answerEndedAtRef.current,
            )}ms`,
          );
          answerEndedAtRef.current = 0;
        }
        stopPolling();
        setTurn(data.turn);
        setQuestionNumber(data.currentQuestionNumber);
        if (data.skillNumber > 0) setSkillNumber(data.skillNumber);
        setAudioError(false);
        setError(null);
        // Retry streaming on the new turn even if it fell back to batch on the
        // previous one — the failure may have been a transient Sarvam blip.
        setStreamFailed(false);
        resetRecorder();
        resetAddState();
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
    resetAddState,
    warmNextQuestionAudio,
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

  // Send a prepared answer form (audio segments OR a streamed transcript) and
  // handle the response identically for both. Queues the video for background
  // upload and moves the UI into polling.
  const sendAnswerForm = useCallback(
    async (
      form: FormData,
      video: Blob | null,
      durationMs: number,
      turnNumber: number,
    ) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setPhase("submitting");
      setError(null);
      // Acknowledge out loud the instant the answer goes — this is what turns
      // the STT->GPT->TTS gap from dead air into a reply.
      playFiller();

      try {
        const response = await fetch(`/api/attempt/${attemptId}/answer`, {
          method: "POST",
          body: form,
        });

        if (response.status === 401) {
          router.push(`/i`);
          return;
        }

        // 409 = the turn was already claimed/completed or has moved on — a
        // duplicate submit (common on mobile, where the auto-advance and a
        // stale recorder event can both fire). The answer is already being
        // processed, so poll rather than show a scary error.
        if (response.status === 409) {
          setPhase("processing");
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

        // Queue the clip and upload it in the background NOW, while the
        // candidate reads and answers the next question — so nothing is left
        // to upload at the end and no one waits on "saving your recordings".
        if (video && video.size > 0) {
          pendingVideosRef.current.push({ turnNumber, video, durationMs });
          void flushRecordings(false);
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
    [attemptId, router, genericError, flushRecordings, playFiller],
  );

  const submitAnswer = useCallback(
    async (segments: Blob[], video: Blob | null, durationMs: number) => {
      if (!turn) return;
      // One part per segment, in order. A long answer arrives as several files
      // because the transcriber will not take more than 30 seconds in one go.
      const form = new FormData();
      segments.forEach((segment, index) => {
        const extension = segment.type.includes("mp4") ? "m4a" : "webm";
        form.append("audio", segment, `answer-${index}.${extension}`);
      });
      form.append("turnNumber", String(turn.turnNumber));
      form.append("durationMs", String(durationMs));
      await sendAnswerForm(form, video, durationMs, turn.turnNumber);
    },
    [turn, sendAnswerForm],
  );

  // Streaming path: the transcript already came from realtime STT, so no audio
  // is uploaded here — the video still archives the answer separately.
  const submitTranscript = useCallback(
    async (transcript: string, video: Blob | null, durationMs: number) => {
      if (!turn) return;
      const form = new FormData();
      form.append("transcript", transcript);
      form.append("turnNumber", String(turn.turnNumber));
      form.append("durationMs", String(durationMs));
      await sendAnswerForm(form, video, durationMs, turn.turnNumber);
    },
    [turn, sendAnswerForm],
  );

  /**
   * The single control the candidate uses: stop recording and send.
   *
   * `stopRecording()` resolves with the finished blobs, so there is no review
   * step and no window in which a half-flushed recording could be submitted.
   */
  const handleNext = useCallback(async () => {
    if (submittingRef.current) return;
    // Already sent this turn (a second silence/backstop/stale event) — ignore.
    const active = turnRef.current;
    if (active && submittedTurnRef.current === active.turnNumber) return;
    if (active) submittedTurnRef.current = active.turnNumber;
    answerEndedAtRef.current = performance.now();

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

  // The max-duration backstop fires from inside the recorder, which cannot see
  // `handleNext`; this ref bridges the two without rebuilding the recorder.
  useEffect(() => {
    submitCurrentAnswerRef.current = () => void handleNext();
  }, [handleNext]);

  /* --------------------------- "add anything?" flow -------------------------- */

  // On the first pause of an answer we invite the candidate to add more before
  // moving on, keeping the mic open. Ask-state refs + reset live above `poll`.
  const addRef = useRef<HTMLAudioElement | null>(null);
  // streaming.rearm, reached via a ref because `streaming` is defined below.
  const streamRearmRef = useRef<() => void>(() => undefined);

  /** Play "would you like to add anything?" — own element, mutes mic while on. */
  const playAdd = useCallback(() => {
    const el = addRef.current;
    if (!el) return;
    try {
      el.currentTime = 0;
      void el.play().catch(() => undefined);
    } catch {
      // Best-effort — if it can't play, the silence timer still advances us.
    }
  }, []);

  /**
   * Actually submit the answer: stop the video (kept for the archive) and send
   * the transcript. Shared by the "they're done" and "they went quiet" paths.
   */
  const finalizeStreamedAnswer = useCallback(
    async (transcript: string) => {
      const active = turnRef.current;
      if (!active) return;
      if (submittedTurnRef.current === active.turnNumber) return;
      if (!transcript.trim()) return;
      submittedTurnRef.current = active.turnNumber;
      clearAddTimer();
      answerEndedAtRef.current = performance.now();
      const { video, durationMs } = await recorder.stopRecording();
      await submitTranscript(transcript, video, durationMs);
    },
    [recorder, submitTranscript, clearAddTimer],
  );

  /**
   * Streaming path: Sarvam signalled end-of-turn with the whole transcript.
   *
   * We don't submit on the first pause. Instead we invite the candidate to add
   * anything — the mic stays open — so they are never cut off mid-thought:
   *   1st pause → stash the answer, play "would you like to add anything?",
   *               re-arm the stream, and start a short silence timer.
   *   2nd pause → a brief reply ("no", "that's all") is a decline, so submit
   *               the stashed answer; anything longer is appended and submitted.
   *   silence   → the timer submits the stashed answer on its own.
   * Empty transcript means we only heard noise, so keep waiting.
   */
  const handleStreamedTurn = useCallback(
    async (transcript: string) => {
      const active = turnRef.current;
      if (!active) return;
      if (submittedTurnRef.current === active.turnNumber) return;
      const text = transcript.trim();
      if (!text) return;

      // First pause: only offer to add if the answer was SHORT — otherwise they
      // clearly said their piece, so submit without nagging.
      if (!addAskedRef.current) {
        const spokenMs =
          speechStartRef.current !== null && speechEndRef.current !== null
            ? speechEndRef.current - speechStartRef.current
            : 0;
        if (spokenMs >= ADD_MAX_ANSWER_MS) {
          await finalizeStreamedAnswer(text);
          return;
        }
        addAskedRef.current = true;
        pendingAnswerRef.current = text;
        playAdd();
        streamRearmRef.current();
        clearAddTimer();
        addTimerRef.current = setTimeout(() => {
          void finalizeStreamedAnswer(pendingAnswerRef.current);
        }, ADD_WAIT_MS);
        return;
      }

      // Their reply to the offer: a few words is a decline; more is a real add.
      clearAddTimer();
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const answer =
        wordCount <= ADD_DECLINE_MAX_WORDS
          ? pendingAnswerRef.current
          : `${pendingAnswerRef.current} ${text}`.trim();
      await finalizeStreamedAnswer(answer);
    },
    [playAdd, clearAddTimer, finalizeStreamedAnswer],
  );

  /* ------------------------------ tap / voice controls ----------------------- */

  /** Play the "did you understand the question?" check-in (own element). */
  const checkRef = useRef<HTMLAudioElement | null>(null);
  const playCheckIn = useCallback(() => {
    const el = checkRef.current;
    if (!el) return;
    try {
      el.currentTime = 0;
      void el.play().catch(() => undefined);
    } catch {
      // Best-effort.
    }
  }, []);

  /** Move past the current question, unscored, and poll for the next. */
  const skipRef = useRef(false);
  const autoSkip = useCallback(async () => {
    const active = turnRef.current;
    if (skipRef.current || !active) return;
    skipRef.current = true;
    // Block any pending auto-submit for this turn and quiet everything.
    submittedTurnRef.current = active.turnNumber;
    stopFiller();
    const el = audioRef.current;
    if (el && !el.paused) el.pause();
    // Stop the live recording CLEANLY before resetting. reset() alone leaves the
    // underlying MediaRecorder in "recording", which then trips startRecording's
    // re-entry guard on the NEXT question — so recording (and the voice meter)
    // never starts after a skip. stopRecording flips it to inactive properly.
    await recorder.stopRecording();
    resetRecorder();
    setError(null);
    setPhase("processing");
    const result = await skipTurnAction(attemptId, active.turnNumber);
    skipRef.current = false;
    if (!result.ok) {
      setError(genericError);
      setPhase("error");
    }
    // Success: the phase-driven poll picks up the next question.
  }, [attemptId, genericError, stopFiller, resetRecorder, recorder]);

  /**
   * The silence ladder, while the candidate has said NOTHING. Stages come from
   * NO_ANSWER_STAGES = [15, 30, 60]:
   *   0 (15s) → spoken "did you understand the question?" check-in;
   *   1 (30s) → nothing here — the visible countdown is derived in the render;
   *   2 (60s) → auto-skip and move on.
   * Any speech resets the ladder before these fire.
   */
  const handleSilenceStage = useCallback(
    (i: number) => {
      if (i === 0) playCheckIn();
      else if (i === 2) void autoSkip();
    },
    [playCheckIn, autoSkip],
  );

  /* ---------------------------- finished speaking ---------------------------- */

  /**
   * Move on by itself once the candidate stops talking.
   *
   * A real interviewer does not wait to be told an answer is over. The
   * candidate simply speaks and pauses; there is no button to press and no
   * countdown shown — when they go quiet, the answer is sent and the next
   * question comes on its own.
   */
  const speech = useSpeechActivity({
    stream: recorder.stream,
    // Off entirely when streaming — Sarvam does the endpointing then. Only the
    // record-then-transcribe path uses this local detector.
    active: !streamingOn && recorder.isRecording && !isBusy,
    // Stop listening while the interviewer's own voice is playing (question,
    // filler, "take your time") so it is never mistaken for the answer.
    speaking,
    silenceSeconds: SILENCE_ADVANCE_SECONDS,
    minSpeechSeconds: MIN_ANSWER_SECONDS,
    // They spoke, then went quiet — send the answer.
    onSilence: () => void handleNext(),
    // They have said nothing — check in, then countdown, then skip.
    noAnswerStages: NO_ANSWER_STAGES,
    onNoAnswerStage: (i) => handleSilenceStage(i),
  });

  // Realtime STT: stream the mic to the relay and let Sarvam decide when the
  // answer is finished. Replaces the local detector above when enabled; a relay
  // failure flips `streamFailed`, which re-enables the local path for the rest
  // of the interview so a bad connection never dead-ends the candidate.
  const streaming = useStreamingStt({
    stream: recorder.stream,
    active: streamingOn && recorder.isRecording && !isBusy,
    languageCode,
    relayUrl,
    // Mute the mic upstream while the interviewer's own clip plays.
    speaking,
    onFinalTurn: (transcript) => void handleStreamedTurn(transcript),
    onFailed: () => setStreamFailed(true),
    // Same silence ladder as the batch path — check in, countdown, skip.
    noAnswerStages: NO_ANSWER_STAGES,
    onSilenceStage: (i) => handleSilenceStage(i),
  });

  // Let handleStreamedTurn re-arm the stream after the "add?" ask without a
  // definition-order cycle (it's declared above `streaming`).
  useEffect(() => {
    streamRearmRef.current = streaming.rearm;
  }, [streaming.rearm]);

  // Track how long the candidate is actually speaking (first partial → last
  // partial), and while the "add anything?" offer is open, cancel the fallback
  // timer the instant they start speaking again — their addition is coming, and
  // only their next real pause should end the turn. Without the cancel the fixed
  // timer fires mid-sentence and cuts them off.
  useEffect(() => {
    if (!streaming.partial) return;
    const now = Date.now();
    if (speechStartRef.current === null) speechStartRef.current = now;
    speechEndRef.current = now;
    if (addTimerRef.current) clearAddTimer();
  }, [streaming.partial, clearAddTimer]);

  // Elapsed silence (candidate has said nothing yet), from whichever detector
  // is live. Drives the visible "skipping in Ns" countdown.
  const silentElapsed = streamingOn ? streaming.silentSeconds : speech.noAnswerIn;
  const skipInSeconds =
    silentElapsed !== null &&
    silentElapsed >= SILENCE_WARN_SECONDS &&
    silentElapsed < SILENCE_SKIP_SECONDS
      ? SILENCE_SKIP_SECONDS - silentElapsed
      : null;

  /* ------------------------------ question audio ----------------------------- */

  /**
   * Play the question when it arrives, then hand over to `beginAnswer`.
   *
   * Autoplay can be blocked without a prior gesture, and a question can have
   * no audio at all if TTS failed — both fall through to a short timer so the
   * candidate is never left with a question and no recording running.
   */
  const turnNumber = turn?.turnNumber ?? null;

  // The question is typed out as it is spoken, rather than snapping in whole —
  // and NOT before they are in fullscreen, so the whole question (text and
  // voice together) only begins once they have entered the interview.
  const typedQuestion = useTypewriter(
    isFullscreen ? (turn?.question ?? "") : "",
  );

  useEffect(() => {
    if (phase !== "answering" || turnNumber === null) return;
    // Hold everything behind the fullscreen gate: playing the question (and the
    // beginAnswer fallback that follows a blocked play) must not run while the
    // candidate is still looking at "Continue in fullscreen" — otherwise the
    // first question is spent, and recording starts, before they have even
    // begun. The click that enters fullscreen is also the gesture that unblocks
    // audio, so playback here succeeds right after it.
    if (!isFullscreen) return;
    // Exactly once per question. Re-entering this effect for any other
    // reason must never restart the audio: calling `play()` on an element
    // that has already ended plays the question again, over the candidate's
    // answer, and the microphone records it.
    if (playedForTurnRef.current === turnNumber) return;
    playedForTurnRef.current = turnNumber;
    questionShownAtRef.current = performance.now();
    // The question has arrived — cut the filler so the two never overlap.
    stopFiller();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const el = audioRef.current;

    /**
     * Speak the question — twice, into two places that cannot affect each
     * other.
     *
     * The candidate hears the ordinary `<audio>` element, straight to the
     * speakers, with nothing in front of it. The recording gets a separate
     * decoded copy mixed into the video's audio track, so playback is the
     * interviewer asking and the candidate answering rather than a
     * monologue against silence.
     *
     * They are separate on purpose. Two earlier versions fed the element
     * itself through the audio graph, and both left the candidate unable to
     * hear the question at all — routing an element is irreversible, and a
     * graph that will not start makes it silent. Here the graph can fail
     * entirely and the only casualty is the interviewer's voice in the
     * recording.
     */
    startQuestionCapture();

    if (el && turnRef.current?.questionAudioId) {
      el.currentTime = 0;
      void el.play().catch(() => {
        timer = setTimeout(beginAnswer, 400);
      });
      // Started alongside, never awaited: the candidate's playback above
      // must not wait on the recording's copy.
      void playIntoRecording(el.src);
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
  }, [
    turnNumber,
    phase,
    isFullscreen,
    beginAnswer,
    startQuestionCapture,
    playIntoRecording,
    stopFiller,
  ]);

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

  if (!turn) {
    return (
      <Alert tone="danger" title={m.interview.unavailableTitle}>
        {m.interview.unavailableBody}
      </Alert>
    );
  }

  const progressLabel = t(m.interview.questionProgress, {
    current: skillNumber,
    total: totalSkills,
  });

  // What the orb is doing. Speaking wins (the interviewer is talking over
  // everything else); then their own voice while recording; then the quiet
  // "thinking" turnover between questions; otherwise it rests.
  const orbState: OrbState = speaking
    ? "speaking"
    : recorder.isRecording
      ? "listening"
      : isBusy
        ? "processing"
        : "idle";

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-linear-to-b from-surface to-surface-muted"
    >
      {/* One filler element; its src is swapped to a random variant per turn
          (variants are pre-warmed on mount). Played the moment an answer is sent
          to mask the processing gap, and it drives the blob too. */}
      <audio
        ref={fillerRef}
        preload="auto"
        className="hidden"
        onPlay={() => setSpeaking(true)}
        onEnded={() => setSpeaking(false)}
        onPause={() => setSpeaking(false)}
      />
      {/* "Did you understand the question?" check-in for the silence ladder. */}
      <audio
        ref={checkRef}
        src={checkUrl}
        preload="auto"
        className="hidden"
        onPlay={() => setSpeaking(true)}
        onEnded={() => setSpeaking(false)}
        onPause={() => setSpeaking(false)}
      />
      {/* "Would you like to add anything?" — first pause of an answer. */}
      <audio
        ref={addRef}
        src={addUrl}
        preload="auto"
        className="hidden"
        onPlay={() => setSpeaking(true)}
        onEnded={() => setSpeaking(false)}
        onPause={() => setSpeaking(false)}
      />

      {/* Top: progress by skill (a follow-up holds the same number). */}
      <header className="shrink-0 px-6 pt-5">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-content-muted">
            {progressLabel}
          </p>
          <p className="text-sm text-content-muted tabular-nums">
            {Math.round((skillNumber / totalSkills) * 100)}%
          </p>
        </div>
        <div className="mx-auto mt-2 max-w-5xl">
          <Progress value={skillNumber} max={totalSkills} label={progressLabel} />
        </div>
      </header>

      {/* Centre stage: the interviewer orb and the question it is asking. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6">
        <VoiceOrb
          state={orbState}
          stream={recorder.stream}
          className="w-56 shrink-0 sm:w-64"
        />

        {/* Selection, copy and context menu are blocked so the question cannot
            be trivially pasted elsewhere — a deterrent only. */}
        <div
          onCopy={preventCapture}
          onCut={preventCapture}
          onContextMenu={preventCapture}
          onDragStart={preventCapture}
          className="w-full max-w-3xl text-center select-none"
        >
          {turn.kind === "language_probe" ? (
            <p className="mb-2 text-xs font-medium tracking-wide text-content-muted uppercase">
              {m.interview.introduction}
            </p>
          ) : null}

          {/* Typed out as it is spoken; the full text is given once to assistive
              tech so a screen reader is not spammed one character at a time. */}
          <h1
            className="text-2xl leading-relaxed font-medium text-balance sm:text-3xl"
            lang={languageCode}
          >
            <span aria-hidden="true">
              {typedQuestion}
              {typedQuestion.length < turn.question.length ? (
                <span className="ml-0.5 inline-block animate-pulse text-accent">
                  |
                </span>
              ) : null}
            </span>
            <span className="sr-only">{turn.question}</span>
          </h1>

          {turn.questionTranslation ? (
            <p
              className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-content-muted"
              lang="en"
            >
              {turn.questionTranslation}
            </p>
          ) : null}

          {turn.questionAudioId ? (
            <audio
              ref={audioRef}
              src={`/api/media/${turn.questionAudioId}?attempt=${attemptId}`}
              onPlay={startQuestionCapture}
              onPlaying={() => {
                setSpeaking(true);
                const from = questionShownAtRef.current;
                if (from) {
                  console.log(
                    `[timing] client.question→audio ${Math.round(
                      performance.now() - from,
                    )}ms`,
                  );
                }
              }}
              // Recording starts when the question finishes playing; without
              // this the candidate is left on "getting ready".
              onEnded={() => {
                setSpeaking(false);
                beginAnswer();
              }}
              onError={() => {
                setSpeaking(false);
                setAudioError(true);
                // Broken audio must not strand them either.
                beginAnswer();
              }}
              preload="auto"
              className="hidden"
            />
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
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
          {audioError ? (
            <p className="mt-2 text-sm text-content-muted">
              {m.interview.audioFailed}
            </p>
          ) : null}
        </div>

        {/* Answer state — a recording pulse while they speak; a quiet spinner
            while the next question is prepared. */}
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-8 items-center"
        >
          {savingRecordings ? (
            <div className="flex flex-wrap items-center gap-3 rounded-full bg-accent-soft px-4 py-2 text-sm text-accent">
              <span
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent"
              />
              <span>{m.interview.savingRecordings}</span>
              <Button size="sm" variant="secondary" onClick={goToResult}>
                {m.dashboard.viewResult}
              </Button>
            </div>
          ) : recorder.isRecording ? (
            <div className="flex flex-col items-center gap-1">
              {/* You're being heard — live bars of the candidate's own voice. */}
              <Waveform stream={recorder.stream} active={recorder.isRecording} />
              {skipInSeconds !== null ? (
                <p className="text-sm font-medium text-warning">
                  {t(m.interview.skippingIn, { seconds: skipInSeconds })}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-content-muted">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger"
                  />
                  {silentElapsed !== null
                    ? m.interview.waitingForAnswer
                    : m.interview.keepSpeaking}
                </p>
              )}
            </div>
          ) : null}
        </div>


        {error ? (
          <Alert tone="danger" title={m.interview.errorTitle} className="max-w-md">
            <p>{error}</p>
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={handleRetrySubmit}>
                {m.interview.recordAgain}
              </Button>
            </div>
          </Alert>
        ) : null}

        {recorder.errorMessage ? (
          <Alert
            tone="danger"
            title={m.interview.micProblemTitle}
            className="max-w-md"
          >
            {recorder.errorMessage}
          </Alert>
        ) : null}
      </div>

      {/* The candidate's self-view, bottom-right like a call. */}
      <div className="absolute right-4 bottom-4 w-40 sm:w-56">
        <CameraPreview
          stream={recorder.previewStream}
          className="w-full shadow-(--shadow-raised)"
        />
      </div>

      {/* Fullscreen gate. Shown until they are in fullscreen — the button is the
          user gesture the browser needs both to go fullscreen AND to unblock
          audio autoplay, so the first question speaks right after it. */}
      {!isFullscreen ? (
        <div className="absolute inset-0 z-50 grid place-items-center bg-content/85 px-6 text-center backdrop-blur-sm">
          <div className="max-w-sm space-y-4">
            <h2 className="text-xl font-semibold text-white">
              Your interview is ready
            </h2>
            <p className="text-sm leading-relaxed text-white/80">
              This runs in fullscreen so you can focus. Please stay in fullscreen
              until the interview is finished.
            </p>
            {/* Entering fullscreen is the gesture that also unblocks audio; the
                question-play effect (gated on `isFullscreen`) then speaks the
                current question right after. */}
            <Button size="lg" onClick={requestFullscreen}>
              Continue in fullscreen
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
