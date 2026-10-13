"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button, Progress } from "~/components/ui";
import { CameraPreview } from "~/components/camera-preview";
import { VoiceOrb } from "~/components/voice-orb";
import type { OrbState } from "~/components/voice-orb";
import { SubmittingOverlay } from "./submitting-overlay";
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
import { isRepeatRequest, isSkipRequest } from "~/config/repeat-requests";
import {
  MAX_ANSWER_SECONDS,
  MIN_ANSWER_BLOB_BYTES,
  AUTO_START_BACKSTOP_MS,
  MIN_ANSWER_SECONDS,
  NO_ANSWER_STAGES,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  SILENCE_ADVANCE_SECONDS,
  MIN_ANSWER_WORDS,
  PROMPT_COUNTDOWN_SECONDS,
  OPENING_BIT_WAIT_MS,
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
  openingBitUrls,
  openingBitTexts,
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
  /** "Would you like to add anything?" — played once per answer. */
  addUrl: string;
  /** The opening turn's 2nd/3rd bits (hobbies, location), played in sequence. */
  openingBitUrls: string[];
  /** On-screen text for those same bits, shown as each one is spoken. */
  openingBitTexts: string[];
  m: Messages;
  /** BCP-47 code of the session language, for correct text rendering. */
  languageCode: string;
}) {
  const router = useRouter();

  const [turn, setTurn] = useState<TurnView | null>(initialTurn);
  const [questionNumber, setQuestionNumber] = useState(initialQuestionNumber);
  // Progress is by skill, not turn: a follow-up keeps the same skill number.
  const [skillNumber, setSkillNumber] = useState(
    Math.max(1, initialSkillNumber),
  );
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
  // On the multi-part opening, the text of the bit currently being spoken
  // (hobbies, then location). Overrides the shown question so the candidate READS
  // the prompt too, not just hears it. Null on every other turn / bit 1.
  const [openingBitText, setOpeningBitText] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** One filler element whose src is swapped to a random variant each turn, so
   *  it never sounds like a recording and never fights the question audio. The
   *  variants are pre-warmed into the browser cache so the swap plays instantly. */
  const fillerRef = useRef<HTMLAudioElement | null>(null);
  const lastFillerRef = useRef(-1);
  useEffect(() => {
    for (const url of [...fillerUrls, ...openingBitUrls]) {
      const warm = new Audio();
      warm.preload = "auto";
      warm.src = url;
    }
  }, [fillerUrls, openingBitUrls]);
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


  /**
   * Which part has already had its spoken prompt.
   *
   * Keyed by PART rather than by turn, because the opening is three parts in
   * one turn — opener, hobbies, where they live. Keyed by turn alone, the
   * invitation to add more would be offered on the first part and never
   * again for the other two.
   *
   * The invitation is offered once per part. If the candidate takes it,
   * speaks, and stops again, the interview moves on without asking a second
   * time — being asked "anything to add?" twice reads as not having been
   * listened to the first time.
   */
  const promptedKeyRef = useRef<string | null>(null);

  /**
   * The countdown shown after a spoken prompt finishes.
   *
   * Driven by its own clock rather than by elapsed silence, because it has to
   * start when the clip STOPS playing — the candidate cannot be expected to
   * answer a question they are still being asked.
   */
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }, []);

  /**
   * Reaching into the streaming hook from callbacks declared above it.
   *
   * Both are assigned once it exists. Declared up here because `beginAnswer`
   * and the silence ladder need them, and a ref has to exist before the hook
   * that captures it.
   */
  const streamRearmRef = useRef<() => void>(() => undefined);
  const getTranscriptRef = useRef<() => string>(() => "");

  const beginAnswer = useCallback(() => {
    const current = turnRef.current;
    if (!current) return;
    if (autoStartedForTurnRef.current === current.turnNumber) return;
    autoStartedForTurnRef.current = current.turnNumber;
    // A fresh question: no countdown running, and the invitation to add more
    // is owed again. Reset here rather than in an effect, because this is the
    // moment the turn actually starts rather than a render that noticed.
    stopCountdown();
    promptedKeyRef.current = null;
    // Belt and braces: nothing from the last question may be readable as an
    // answer to this one, whatever path got us here.
    streamRearmRef.current();
    void startRecordingFn();
  }, [startRecordingFn, stopCountdown]);

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
  /**
   * The interview is over and the last recordings are uploading.
   *
   * Named apart from `submittingRef`, which guards a single answer being sent
   * twice — this is the whole interview ending, and it happens once.
   *
   * Set the instant the server says the interview is complete, BEFORE the
   * upload rather than after, because covering those seconds is the entire
   * point. Never cleared: the only way out is the navigation to the results.
   */
  const [finalising, setFinalising] = useState(false);
  /**
   * How much of the final upload is done, as a real count of recordings.
   *
   * Honest by construction: `flushRecordings` sends them one at a time over a
   * queue whose length is known before it starts, so this is progress that
   * actually happened rather than a bar animated against a guess. `total` is
   * zero when everything was already uploaded during the interview, which is
   * the common case — the overlay shows an indeterminate state for the moment
   * it takes to navigate.
   */
  const [upload, setUpload] = useState({ done: 0, total: 0 });
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
      if (visible) {
        setSavingRecordings(true);
        setUpload({ done: 0, total: queued.length });
      }
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
          // Counted whether or not it succeeded: the bar tracks how far
          // through the queue we are, and a failed upload is re-queued for
          // the background sweep rather than retried in front of the
          // candidate.
          if (visible) setUpload((p) => ({ ...p, done: p.done + 1 }));
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

  // The opening bit's silence-fallback timer, and the multi-part opening state
  // (probe turn only): how many bits have been answered and the running combined
  // introduction. `poll` resets these when a turn (re)arms.
  const addTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingStepRef = useRef(0);
  const openingTranscriptRef = useRef("");

  const clearAddTimer = useCallback(() => {
    if (addTimerRef.current) {
      clearTimeout(addTimerRef.current);
      addTimerRef.current = null;
    }
  }, []);

  const resetAddState = useCallback(() => {
    openingStepRef.current = 0;
    openingTranscriptRef.current = "";
    setOpeningBitText(null);
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
        // Blur the interview away first, then upload behind it. Setting this
        // after the race would show the overlay only once there was nothing
        // left to wait for.
        setFinalising(true);
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

  /* ------------------------------ opening bits ------------------------------ */

  // One element whose src is swapped to the next opening bit clip (hobbies, then
  // location), same pattern as the filler element.
  const openingRef = useRef<HTMLAudioElement | null>(null);
  // streaming.rearm and streaming.getTranscript, reached via refs because
  // `streaming` is defined below.
  // advanceOpening, reached via a ref so the silence-fallback timer can call the
  // latest version without a definition-order cycle.
  const advanceOpeningRef = useRef<(text: string) => void>(() => undefined);
  /** Reached from `handleUtterance`, which is declared above `handleAdvance`. */
  const handleAdvanceRef = useRef<() => void>(() => undefined);

  /** Play the Nth opening bit clip (mutes the mic while it plays). */
  const playOpeningBit = useCallback(
    (index: number) => {
      const el = openingRef.current;
      const url = openingBitUrls[index];
      if (!el || !url) return;
      try {
        el.src = url;
        el.currentTime = 0;
        void el.play().catch(() => undefined);
      } catch {
        // Best-effort — a blocked clip just means the bit is skipped silently.
      }
    },
    [openingBitUrls],
  );

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
      stopCountdown();
      /**
       * Empty the buffer the moment this answer is taken.
       *
       * `transcriptRef` lives for the whole session, not the turn, so an
       * answer that had been submitted was still sitting there when the next
       * question arrived. The consequences compounded: the stale words made
       * the candidate look as though they had already answered, which
       * triggered "would you like to add anything?" and then the countdown,
       * which submitted the SAME text again — and scored it again. One reply
       * ended up answering five questions.
       */
      streamRearmRef.current();
      answerEndedAtRef.current = performance.now();
      const { video, durationMs } = await recorder.stopRecording();
      await submitTranscript(transcript, video, durationMs);
    },
    [recorder, submitTranscript, clearAddTimer, stopCountdown],
  );

  /**
   * Advance the multi-part opening turn.
   *
   * Fold this bit's answer into the running introduction, then EITHER ask the
   * next bit (hobbies → location) with the mic still recording, OR — after the
   * last bit — submit the whole combined introduction as the opening answer. A
   * silence-fallback timer moves things on if a bit goes unanswered, so the
   * interview never stalls at the very start.
   */
  const advanceOpening = useCallback(
    (text: string) => {
      const combined = text
        ? `${openingTranscriptRef.current} ${text}`.trim()
        : openingTranscriptRef.current;
      openingTranscriptRef.current = combined;

      const step = openingStepRef.current;
      if (step < openingBitUrls.length) {
        openingStepRef.current = step + 1;
        setOpeningBitText(openingBitTexts[step] ?? null);
        playOpeningBit(step);
        streamRearmRef.current();
        clearAddTimer();
        addTimerRef.current = setTimeout(
          () => advanceOpeningRef.current(""),
          OPENING_BIT_WAIT_MS,
        );
        return;
      }
      clearAddTimer();
      void finalizeStreamedAnswer(combined);
    },
    [
      openingBitUrls.length,
      openingBitTexts,
      playOpeningBit,
      clearAddTimer,
      finalizeStreamedAnswer,
    ],
  );
  useEffect(() => {
    advanceOpeningRef.current = advanceOpening;
  }, [advanceOpening]);

  /* ------------------------------ tap / voice controls ----------------------- */

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const startedFor = turnRef.current?.turnNumber;
    const endsAt = Date.now() + PROMPT_COUNTDOWN_SECONDS * 1000;
    setCountdown(PROMPT_COUNTDOWN_SECONDS);
    countdownRef.current = setInterval(() => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        // Belt and braces: never act on a question that has since moved on.
        if (turnRef.current?.turnNumber !== startedFor) return;
        // Submit what was heard, or skip when there is genuinely nothing.
        handleAdvanceRef.current();
        return;
      }
      setCountdown(left);
    }, 250);
  }, []);


  /** Play "would you like to add anything?" (own element). */
  const addRef = useRef<HTMLAudioElement | null>(null);
  const playAddPrompt = useCallback(() => {
    const el = addRef.current;
    if (!el) return false;
    try {
      el.currentTime = 0;
      void el.play().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Give the opening turn its full wait again, from now.
   *
   * Called whenever the interviewer has just finished speaking over it. The
   * opening advances itself on a timer; anything that talks must stop that
   * timer first and restart it here, or the next part arrives mid-sentence.
   * A no-op on ordinary questions, which advance by their own countdown.
   */
  /**
   * They started talking: nothing is allowed to move on underneath them.
   *
   * Cancels BOTH clocks — the countdown that follows "anything to add?", and
   * the opening's own advance timer. The second one is the important half:
   * it fires on a fixed delay regardless of what the microphone is hearing,
   * so without this it could play the next part over somebody mid-sentence
   * and take their unfinished answer with it.
   *
   * Nothing needs to restart them. Whichever clock is wanted next is set
   * when they stop speaking, by the silence ladder.
   */
  const handleSpeechStart = useCallback(() => {
    stopCountdown();
    clearAddTimer();
  }, [stopCountdown, clearAddTimer]);

  const resumeOpeningWait = useCallback(() => {
    if (turnRef.current?.kind !== "language_probe") return;
    clearAddTimer();
    addTimerRef.current = setTimeout(
      () => advanceOpeningRef.current(""),
      OPENING_BIT_WAIT_MS,
    );
  }, [clearAddTimer]);

  /** Play the "did you understand the question?" check-in (own element). */
  const checkRef = useRef<HTMLAudioElement | null>(null);
  const playCheckIn = useCallback(() => {
    const el = checkRef.current;
    if (!el) {
      resumeOpeningWait();
      return false;
    }
    try {
      el.currentTime = 0;
      /**
       * A refused `play()` rejects without ever firing `ended` or `error`.
       *
       * That matters here because the caller has already cancelled the
       * opening advance to make room for this clip — so a browser quietly
       * blocking autoplay would leave the interview waiting on a timer
       * nothing was going to restart. Hand the wait back immediately.
       */
      void el.play().catch(() => resumeOpeningWait());
      return true;
    } catch {
      resumeOpeningWait();
      return false;
    }
  }, [resumeOpeningWait]);

  /** Move past the current question, unscored, and poll for the next. */
  const skipRef = useRef(false);
  const autoSkip = useCallback(async () => {
    const active = turnRef.current;
    if (skipRef.current || !active) return;
    skipRef.current = true;
    // Block any pending auto-submit for this turn and quiet everything.
    submittedTurnRef.current = active.turnNumber;
    stopCountdown();
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
  }, [attemptId, genericError, stopFiller, stopCountdown, resetRecorder, recorder]);

  /**
   * The silence ladder, in seconds since the candidate last stopped speaking.
   *
   * Two situations, told apart by whether they have said anything at all.
   *
   * THEY ANSWERED, then went quiet (rung 0, 3s). The first time, they are
   * invited to add more; the countdown then runs from the moment that clip
   * ends and submits the answer if nothing follows. If they do add something
   * and stop again, this rung comes round a second time, and that time the
   * interview simply moves on — asking "anything to add?" twice reads as not
   * having listened the first time.
   *
   * THEY HAVE SAID NOTHING (rung 1, 15s). Probably stuck on the question, so
   * ask whether they followed it; the same countdown then runs and skips the
   * question if the silence holds. Asking somebody who has just answered
   * whether they understood the question would be worse than saying nothing,
   * which is why the two rungs are separate.
   *
   * Either clip failing to play falls through to the countdown anyway, so a
   * browser that refuses audio cannot strand the interview in silence.
   */
  const handleSilenceStage = useCallback(
    (i: number) => {
      const active = turnRef.current;
      if (!active) return;
      const opening = active.kind === "language_probe";

      /**
       * Whether they have ANSWERED — one test, used by every rung.
       *
       * The rungs used to judge this two different ways: the check-in asked
       * the voice detector, the offer to add more asked whether any words
       * existed. Background noise trips the detector and the speech model
       * turns the same noise into a couple of phantom words, so a silent
       * candidate was ruled out of the check-in ("they spoke") and into the
       * countdown ("there are words") at the same moment — and moved on
       * without having said anything. Counting real words settles both.
       */
      const words = getTranscriptRef
        .current()
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      const answered = words >= MIN_ANSWER_WORDS;

      /**
       * The opening is three parts in ONE turn, so a part is identified by
       * both. Without the step, the second and third parts would count as
       * already prompted and be hurried along in silence.
       */
      const key = opening
        ? `${active.turnNumber}:${openingStepRef.current}`
        : `${active.turnNumber}`;

      /**
       * Rung 2: never spoke, and the question has been on screen a long time.
       * Move on quietly — no clip, no countdown. A backstop against a
       * question hanging for ever, not a nudge. The opening has its own
       * fallback and does not need this one.
       */
      if (i === 2) {
        // Applies to the opening as well now: it is the last resort if noise
        // keeps cancelling the opening's own timer and nothing is ever said.
        if (!answered) handleAdvanceRef.current();
        return;
      }

      /**
       * Rung 1: they have said nothing, so ask whether they followed it — and
       * then WAIT. No countdown follows a check-in: being asked "did you
       * understand?" and immediately watching a timer start reads as being
       * hurried out of a question rather than helped with it.
       */
      if (i === 1) {
        if (answered || promptedKeyRef.current === key) return;
        promptedKeyRef.current = key;
        // Take the floor first: the opening advances itself on a timer, and
        // letting that fire mid-clip plays the next part over this one.
        clearAddTimer();
        playCheckIn();
        return;
      }

      /**
       * Rung 0: they answered and stopped. Offer to add more; the countdown
       * that follows the offer is what moves things on.
       *
       * This applies to the opening too. Each of its parts is an answer like
       * any other, and being cut off three seconds after finishing — with no
       * chance to add the thing you were still thinking of — is the same
       * abruptness on the introduction as it was on the questions.
       */
      /**
       * `hasSpoken` is the voice DETECTOR, which is not the same as having
       * answered. A cough, a chair, the tail of the question bleeding back
       * through the speakers — any of those set it, and the candidate was
       * then asked "would you like to add anything?" three seconds into a
       * question they had not yet said a word about.
       *
       * So the offer is gated on there being actual transcribed words. No
       * words means nothing was said, whatever the detector heard, and it is
       * the check-in rung that belongs to that.
       */
      if (!answered) return;

      if (promptedKeyRef.current === key) {
        // Second time quiet on this part: move on without saying anything.
        handleAdvanceRef.current();
        return;
      }
      promptedKeyRef.current = key;
      // Again, take the floor before speaking over the opening's own timer.
      clearAddTimer();
      if (!playAddPrompt()) startCountdown();
    },
    [playAddPrompt, playCheckIn, startCountdown, clearAddTimer],
  );

  /**
   * Say the question again, from the browser, asking the server nothing.
   *
   * The clip is already here — this is the same element that played it a
   * moment ago, preloaded — so a repeat costs one `play()` call.
   *
   * It used to cost a full round trip. "Phir se boliye" was submitted as
   * though it were the answer; the server recognised the phrase, recorded a
   * replay, and the browser only found out on its next poll. Several seconds
   * to re-play audio already sitting in memory, and the length varied with
   * the network and where the poll happened to land — which is why the same
   * request sometimes felt instant and sometimes did not.
   *
   * Worse, the microphone had already reopened by then, so everything the
   * candidate said while waiting was captured as part of their answer.
   *
   * The transcript is re-armed rather than kept: a request to repeat is an
   * instruction, not an answer, and leaving it in means it gets scored as one.
   *
   * Returns false when the clip cannot be played at all — no audio for this
   * turn, or the browser refusing playback — so the caller can fall back to
   * the server path rather than silently doing nothing.
   */
  const replayQuestion = useCallback((): boolean => {
    const el = audioRef.current;
    if (!el || !turnRef.current?.questionAudioId) return false;
    // Mid-sentence already: asking again while it is speaking means they did
    // not notice it start, not that they want it a third time.
    if (!el.paused) return true;
    streamRearmRef.current();
    try {
      el.currentTime = 0;
      void el.play().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * A spoken request, acted on the moment it is heard.
   *
   * "Say that again" and "skip this one" are instructions, not answers. The
   * server already knows what to do with them — it replays the question, or
   * moves on — but only once a transcript reaches it, and the only thing that
   * sends one is the candidate pressing Next. So a student who asked for a
   * repeat and then waited, which is exactly what asking for a repeat means,
   * got nothing at all.
   *
   * Safe against false positives by construction: the phrase lists refuse to
   * match anything longer than eight words, and this is handed the WHOLE
   * transcript so far, so a real answer that happens to contain "repeat" is
   * already too long to qualify.
   *
   * The opening turn needs its own handling rather than being skipped. It is
   * three parts in one turn, so "say that again" there means the part they
   * are on — not the whole sequence from the top, which is what they got
   * when the request was swallowed and treated as their answer.
   */
  const handleUtterance = useCallback(
    (text: string) => {
      const active = turnRef.current;
      if (!active) return;

      if (active.kind === "language_probe") {
        if (!isRepeatRequest(text)) return;
        // Stop the pending advance before replaying anything, or the next
        // part arrives over the top of the repeat they just asked for. Each
        // clip restarts the wait when it ends.
        clearAddTimer();
        const step = openingStepRef.current;
        // Step 0 is still the opener itself, which plays from the question
        // element; after that each step has played the bit before it.
        if (step === 0) replayQuestion();
        else {
          playOpeningBit(step - 1);
          // The request is an instruction, not part of the introduction.
          streamRearmRef.current();
        }
        return;
      }

      if (isRepeatRequest(text)) {
        // Served from here. Only a clip that will not play falls through to
        // the server, which can still do it the slow way.
        if (!replayQuestion()) handleAdvanceRef.current();
        return;
      }
      // Skipping genuinely needs the server — it is the only thing that can
      // retire this turn and hand back the next one.
      if (isSkipRequest(text)) handleAdvanceRef.current();
    },
    [replayQuestion, playOpeningBit, clearAddTimer],
  );

  /**
   * The candidate taps "Next" when they are done.
   *
   * This is now the ONLY way a turn advances — the VAD no longer auto-submits on
   * a pause, so stray noise can never move the interview on. Streaming: submit
   * whatever has been transcribed so far (or, on the opening turn, move to the
   * next bit); nothing heard at all is treated as a skip. Batch fallback: stop,
   * transcribe, submit.
   */
  const handleAdvance = useCallback(() => {
    const active = turnRef.current;
    if (!active || isBusy) return;
    if (submittedTurnRef.current === active.turnNumber) return;
    // Pressing Next during "would you like to add anything?" must end the
    // countdown too. Left running, it reached zero on the NEXT question and
    // skipped it before its audio had played.
    stopCountdown();

    if (!streamingOn) {
      void handleNext();
      return;
    }
    const text = getTranscriptRef.current().trim();
    if (active.kind === "language_probe") {
      clearAddTimer();
      advanceOpening(text);
      return;
    }
    if (!text) {
      void autoSkip();
      return;
    }
    void finalizeStreamedAnswer(text);
  }, [
    isBusy,
    streamingOn,
    handleNext,
    stopCountdown,
    clearAddTimer,
    advanceOpening,
    autoSkip,
    finalizeStreamedAnswer,
  ]);

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
    // No auto-submit on a pause any more — the candidate taps "Next" when done,
    // so stray noise can't advance the interview. The no-answer ladder (check-in
    // then a long skip backstop) still runs so a silent screen isn't permanent.
    onSilence: () => undefined,
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
    // No auto-advance on a pause — the transcript is read on demand when the
    // candidate taps "Next" (see handleAdvance / getTranscript).
    onFinalTurn: () => undefined,
    onFailed: () => setStreamFailed(true),
    // The no-answer ladder still runs — check in, then a long skip backstop.
    noAnswerStages: NO_ANSWER_STAGES,
    onSilenceStage: (i) => handleSilenceStage(i),
    // Talking again means nothing moves on underneath them.
    onSpeechStart: handleSpeechStart,
    onUtterance: handleUtterance,
  });

  // Reach streaming.rearm / streaming.getTranscript from handlers declared above
  // `streaming` without a definition-order cycle.
  useEffect(() => {
    handleAdvanceRef.current = handleAdvance;
  }, [handleAdvance]);

  useEffect(() => {
    streamRearmRef.current = streaming.rearm;
    getTranscriptRef.current = streaming.getTranscript;
  }, [streaming.rearm, streaming.getTranscript]);

  // The opening bit's silence-fallback must not fire while the candidate is
  // speaking — cancel it the moment a partial transcript appears.
  useEffect(() => {
    if (streaming.partial && addTimerRef.current) clearAddTimer();
  }, [streaming.partial, clearAddTimer]);

  // Elapsed silence (candidate has said nothing yet), from whichever detector
  // is live. Drives the visible "skipping in Ns" countdown.
  const silentElapsed = streamingOn
    ? streaming.silentSeconds
    : speech.noAnswerIn;
  // The visible countdown is now the one started when a spoken prompt ends,
  // not a slice of elapsed silence: the candidate should get the whole of it
  // from the moment they can actually act on it.
  const skipInSeconds = countdown;

  /* ------------------------------ question audio ----------------------------- */

  /**
   * Play the question when it arrives, then hand over to `beginAnswer`.
   *
   * Autoplay can be blocked without a prior gesture, and a question can have
   * no audio at all if TTS failed — both fall through to a short timer so the
   * candidate is never left with a question and no recording running.
   */
  const turnNumber = turn?.turnNumber ?? null;

  // On the opening turn the shown text follows the bit being spoken; every other
  // turn just shows the question. The override is cleared in `poll` when a turn
  // (re)arms, alongside the other per-turn state.
  const displayQuestion = openingBitText ?? turn?.question ?? "";

  // The question is typed out as it is spoken, rather than snapping in whole —
  // and NOT before they are in fullscreen, so the whole question (text and
  // voice together) only begins once they have entered the interview.
  const typedQuestion = useTypewriter(isFullscreen ? displayQuestion : "");

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
  /** Skills behind them. 0 on the opening probe, where `skillNumber` is 0. */
  const completedSkills = Math.max(0, skillNumber - 1);

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
      {/* The last thing the candidate sees here: the interview blurs back
          while the final recordings upload, until the results page replaces
          this one. Rendered inside the stage so it covers the whole of it. */}
      {finalising ? (
        <SubmittingOverlay
          title={m.interview.submittingInterview}
          hint={
            upload.total > 0
              ? t(m.interview.savingProgress, {
                  done: Math.min(upload.done + 1, upload.total),
                  total: upload.total,
                })
              : m.interview.submittingHint
          }
          done={upload.done}
          total={upload.total}
        />
      ) : null}
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
      {/* "Did you understand the question?" check-in for the silence ladder.
          The countdown starts when it ENDS, never while it is still playing. */}
      <audio
        ref={checkRef}
        src={checkUrl}
        preload="auto"
        className="hidden"
        onPlay={() => setSpeaking(true)}
        onEnded={() => {
          setSpeaking(false);
          resumeOpeningWait();
        }}
        onPause={() => setSpeaking(false)}
        onError={() => {
          setSpeaking(false);
          resumeOpeningWait();
        }}
      />
      {/* "Would you like to add anything?" — once per answer. */}
      <audio
        ref={addRef}
        src={addUrl}
        preload="auto"
        className="hidden"
        onPlay={() => setSpeaking(true)}
        onEnded={() => {
          setSpeaking(false);
          startCountdown();
        }}
        onPause={() => setSpeaking(false)}
        onError={() => {
          setSpeaking(false);
          startCountdown();
        }}
      />
      {/* Opening bits (hobbies, then location); src swapped per bit. */}
      <audio
        ref={openingRef}
        preload="auto"
        className="hidden"
        onPlay={() => setSpeaking(true)}
        onEnded={() => {
          setSpeaking(false);
          // Only NOW has the prompt finished — start the silence-fallback here so
          // the candidate gets the full window to answer this bit. (The timer set
          // in advanceOpening is a backstop for a clip that never plays.)
          clearAddTimer();
          addTimerRef.current = setTimeout(
            () => advanceOpeningRef.current(""),
            OPENING_BIT_WAIT_MS,
          );
        }}
        onPause={() => setSpeaking(false)}
      />

      {/*
       * Top: how much is DONE, which is not the same as which question is on
       * screen. The bar used to be `skillNumber / totalSkills`, so arriving at
       * the last question filled it to 100% before the candidate had said a
       * word — and if that answer earned a follow-up, they then sat answering
       * more questions under a bar claiming they had finished.
       *
       * Counting COMPLETED skills instead means the last question sits just
       * short of full until it is actually answered, and a follow-up simply
       * holds the bar where it is rather than contradicting it. The label
       * still says "Question 11 of 11", because that part was always true.
       */}
      <header className="shrink-0 px-6 pt-5">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-content-muted">
            {progressLabel}
          </p>
          <p className="text-sm text-content-muted tabular-nums">
            {Math.round((completedSkills / totalSkills) * 100)}%
          </p>
        </div>
        <div className="mx-auto mt-2 max-w-5xl">
          <Progress
            value={completedSkills}
            max={totalSkills}
            label={progressLabel}
          />
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
              {typedQuestion.length < displayQuestion.length ? (
                <span className="ml-0.5 inline-block animate-pulse text-accent">
                  |
                </span>
              ) : null}
            </span>
            <span className="sr-only">{displayQuestion}</span>
          </h1>

          {/* The translation belongs to the server question (bit 1); the later
              bits are already in the interview language, so hide it for them. */}
          {turn.questionTranslation && openingBitText === null ? (
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
                /**
                 * The opening turn needs its wait started here.
                 *
                 * Each later part starts one when its own clip ends, but the
                 * FIRST part is this question audio, which knows nothing
                 * about the opening sequence — so the opener had none at all
                 * and, once the ladder stopped advancing the opening, a
                 * candidate who never spoke would have waited for ever.
                 */
                resumeOpeningWait();
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
            <div className="flex flex-col items-center gap-3">
              {/* You're being heard — live bars of the candidate's own voice. */}
              <Waveform
                stream={recorder.stream}
                active={recorder.isRecording}
              />
              {skipInSeconds !== null ? (
                <p className="text-sm font-medium text-warning">
                  {/* Always "moving on": the only countdown left follows
                      the invitation to add more, and it ends by SUBMITTING
                      their answer. Nothing is skipped. */}
                  {t(m.interview.advancingIn, { seconds: skipInSeconds })}
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
              {/* The candidate advances when THEY are done — nothing moves on by
                  itself, so stray noise can't skip ahead. Disabled while the
                  interviewer is still speaking the question/bit. */}
              <Button
                size="lg"
                onClick={handleAdvance}
                disabled={speaking || isBusy}
              >
                {m.interview.next}
              </Button>
            </div>
          ) : null}
        </div>

        {error ? (
          <Alert
            tone="danger"
            title={m.interview.errorTitle}
            className="max-w-md"
          >
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
          audio autoplay, so the first question speaks right after it.

          Not once the interview is finishing: this gate sits at the same layer
          and later in the DOM, so a candidate who left fullscreen at the very
          end would be told to go back into it for an interview that is already
          over. */}
      {!isFullscreen && !finalising ? (
        <div className="absolute inset-0 z-50 grid place-items-center bg-content/85 px-6 text-center backdrop-blur-sm">
          <div className="max-w-sm space-y-4">
            <h2 className="text-xl font-semibold text-white">
              Your interview is ready
            </h2>
            <p className="text-sm leading-relaxed text-white/80">
              This runs in fullscreen so you can focus. Please stay in
              fullscreen until the interview is finished.
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
