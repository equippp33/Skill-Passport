"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Records one answer as audio (always) and video (when the camera is granted).
 *
 * Two MediaRecorders run over the same getUserMedia stream:
 *
 *  - an AUDIO-ONLY recorder, fed a MediaStream containing just the audio
 *    track. Its blob is what goes to Sarvam for transcription, so the STT
 *    request is always a clean audio container rather than a video one.
 *  - a VIDEO recorder over the full stream, kept purely as a record of the
 *    answer. It is uploaded separately and never blocks the interview.
 *
 * Guarantees the flow depends on:
 *  - devices are only requested after an explicit user action;
 *  - exactly one recording can be in flight;
 *  - the camera and microphone are acquired ONCE and held for the whole
 *    interview, so the candidate is not re-prompted between questions and the
 *    preview never flickers. They are released by `release()` or on unmount,
 *    which is what stops the camera light;
 *  - a hard cap on duration, enforced here and again by the size checks.
 */

export type RecorderState =
  | "idle"
  | "requesting"
  | "ready"
  | "recording"
  | "recorded"
  | "denied"
  | "unsupported"
  | "error";

export interface UseAnswerRecorderOptions {
  maxSeconds: number;
  /** Ask for the camera as well. Audio-only still works if it is refused. */
  withVideo?: boolean;
  onMaxDurationReached?: () => void;
}

const AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
];

const VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

/**
 * Length of one transcription segment, in seconds.
 *
 * Sarvam's synchronous speech-to-text refuses anything over 30 seconds
 * outright ("use the batch API for longer audio files"), so a two-minute
 * answer cannot be sent as one file. The audio recorder is therefore
 * stopped and restarted on this interval, which yields a series of
 * complete, independently decodable WebM files — unlike MediaRecorder's own
 * timeslice chunks, where only the first carries the container header.
 *
 * Twenty-five leaves room for the clock and the encoder to disagree
 * slightly without tripping the limit.
 */
const AUDIO_SEGMENT_SECONDS = 25;

/** Keep webcam files small enough to upload on a modest connection. */
const VIDEO_BITS_PER_SECOND = 600_000;
const AUDIO_BITS_PER_SECOND = 64_000;

function pickMimeType(candidates: string[]): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function useAnswerRecorder({
  maxSeconds,
  withVideo = false,
  onMaxDurationReached,
}: UseAnswerRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  /**
   * Mirror of `state` for callbacks to read.
   *
   * `startRecording` needs the current state for its re-entry guard, but
   * depending on `state` would give it a new identity every time recording
   * starts or stops. Callers wire that identity into effects, so the churn
   * made those effects re-run mid-answer — which is what used to replay the
   * question over the candidate while they were talking.
   */
  const stateRef = useRef<RecorderState>("idle");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** True when the camera was granted; false means audio-only. */
  const [hasCamera, setHasCamera] = useState(false);
  /** Why the camera is unavailable, for an accurate message in the UI. */
  const [cameraError, setCameraError] = useState<string | null>(null);
  /**
   * Mirror of `hasCamera`.
   *
   * `setHasCamera` does not apply until the next render, so anything reading
   * it inside the same async flow — the device check, and `startRecording`
   * right after it requests permission — would see a stale `false` and
   * silently fall back to audio-only. Read this instead.
   */
  const hasCameraRef = useRef(false);

  /**
   * A mix bus that feeds the VIDEO RECORDER ONLY.
   *
   * The webcam clip should contain the interviewer's question as well as the
   * answer, or playback is a monologue: the candidate replying to silence.
   *
   * Note what is NOT here. The candidate's own `<audio>` player is never
   * routed through this graph. Two earlier attempts did exactly that, and
   * both left the candidate unable to hear the question — routing an
   * element is irreversible, and a graph that will not start turns it
   * silent. So the question is played TWICE and independently: through the
   * plain element for the candidate, and as a decoded copy into this bus
   * for the recording. Nothing here connects to `context.destination`, so
   * nothing here can ever take the candidate's audio away. If the graph
   * fails, the recording misses the question and the interview is fine.
   */
  const mixContextRef = useRef<AudioContext | null>(null);
  const mixDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(
    null,
  );
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  /** Decoded question clips, keyed by URL, so a repeat costs nothing. */
  const clipCacheRef = useRef(new Map<string, AudioBuffer>());

  const streamRef = useRef<MediaStream | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  /** Finished audio segments for this take, in order. */
  const audioSegmentsRef = useRef<Blob[]>([]);
  const segmentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Set while rolling over, so `onstop` knows not to finish the take. */
  const rollingOverRef = useRef(false);
  const videoChunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  /** When the current take started, for its measured duration. */
  const startedAtRef = useRef<number | null>(null);
  const maxReachedRef = useRef(onMaxDurationReached);
  /** Live camera feed, attached to the <video> preview element. */
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  /**
   * The captured stream itself, camera or not.
   *
   * `previewStream` is only set when there is a camera to show; silence
   * detection needs the audio track whether or not the webcam was granted.
   */
  const [stream, setStream] = useState<MediaStream | null>(null);
  /**
   * Resolved when both recorders have flushed. `stop()` is fire-and-forget in
   * the MediaRecorder API, so this is how a caller can await the blobs and
   * submit them in one action.
   */
  const stopResolveRef = useRef<
    | ((value: {
        audio: Blob | null;
        audioSegments: Blob[];
        video: Blob | null;
      }) => void)
    | null
  >(null);
  const finishedAudioRef = useRef<Blob | null>(null);
  const finishedVideoRef = useRef<Blob | null>(null);
  const pendingStopsRef = useRef(0);

  /** Resolve the pending stop promise once every recorder has reported in. */
  const settleStop = useCallback(() => {
    pendingStopsRef.current -= 1;
    if (pendingStopsRef.current > 0) return;
    const resolve = stopResolveRef.current;
    stopResolveRef.current = null;
    resolve?.({
      audio: finishedAudioRef.current,
      audioSegments: audioSegmentsRef.current,
      video: finishedVideoRef.current,
    });
  }, []);

  useEffect(() => {
    maxReachedRef.current = onMaxDurationReached;
  }, [onMaxDurationReached]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    // Points at tracks that no longer exist. The context and the bus stay:
    // decoded clips are cached against them.
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    previewStreamRef.current = null;
    setPreviewStream(null);
    setStream(null);
  }, []);

  const clearSegmentTimer = useCallback(() => {
    if (segmentTimerRef.current) {
      clearInterval(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  }, []);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Release devices and any object URL if the candidate navigates away.
  useEffect(() => {
    return () => {
      clearTick();
      clearSegmentTimer();
      stopTracks();
      revokePreview();
      for (const rec of [audioRecorderRef.current, videoRecorderRef.current]) {
        if (rec && rec.state !== "inactive") rec.stop();
      }
    };
  }, [clearTick, clearSegmentTimer, stopTracks, revokePreview]);

  /**
   * Explicit permission request — also used by the device check.
   *
   * Returns the outcome directly rather than relying on state, which the
   * caller cannot read until the next render.
   */
  const requestPermission = useCallback(async (): Promise<{
    granted: boolean;
    hasCamera: boolean;
  }> => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setState("unsupported");
      setErrorMessage(
        "This browser does not support recording. Try the latest Chrome, Edge, Firefox or Safari.",
      );
      return { granted: false, hasCamera: false };
    }
    if (pickMimeType(AUDIO_MIME_TYPES) === null) {
      setState("unsupported");
      setErrorMessage(
        "This browser cannot record a supported audio format. Try Chrome, Edge or Firefox.",
      );
      return { granted: false, hasCamera: false };
    }

    setState("requesting");
    setErrorMessage(null);
    setCameraError(null);

    const audioConstraint: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    const videoConstraint: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: "user",
    };

    try {
      let stream: MediaStream;
      let camera = false;

      if (withVideo) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraint,
            video: videoConstraint,
          });
          camera = true;
        } catch (cameraFailure) {
          // Camera refused, absent or busy — fall back to audio so the
          // interview can still be completed and scored. Keep the reason so
          // the UI can say something more useful than "no camera".
          const name =
            cameraFailure instanceof DOMException ? cameraFailure.name : "";
          setCameraError(
            name === "NotAllowedError" || name === "SecurityError"
              ? "Camera access was blocked in your browser."
              : name === "NotFoundError"
                ? "No camera was found on this device."
                : name === "NotReadableError" || name === "AbortError"
                  ? "The camera is already in use by another app."
                  : "The camera could not be started.",
          );
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraint,
          });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
        });
      }

      streamRef.current = stream;
      setStream(stream);
      hasCameraRef.current = camera;
      setHasCamera(camera);
      if (camera) {
        previewStreamRef.current = stream;
        setPreviewStream(stream);
      }
      setState("ready");
      return { granted: true, hasCamera: camera };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState("denied");
        setErrorMessage(
          "Access was blocked. Allow the microphone (and camera) in your browser's address-bar permissions, then try again.",
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setState("error");
        setErrorMessage("No microphone was found. Connect one and try again.");
      } else {
        setState("error");
        setErrorMessage(
          "The microphone could not be started. Close other apps using it and try again.",
        );
      }
      return { granted: false, hasCamera: false };
    }
  }, [withVideo]);

  /**
   * Camera track plus the mix bus, for the video recorder.
   *
   * Returns null when there is nothing to mix into — the caller then uses
   * the capture stream unchanged and simply records the candidate alone.
   */
  const buildRecordingStream = useCallback(
    (capture: MediaStream): MediaStream | null => {
      const videoTracks = capture.getVideoTracks();
      const audioTracks = capture.getAudioTracks();
      if (videoTracks.length === 0 || audioTracks.length === 0) return null;

      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;

      try {
        const context = (mixContextRef.current ??= new AudioCtx());
        const bus = (mixDestinationRef.current ??=
          context.createMediaStreamDestination());

        // The microphone joins once and stays; connecting per answer would
        // stack gain with every question.
        if (!micSourceRef.current) {
          micSourceRef.current = context.createMediaStreamSource(
            new MediaStream(audioTracks),
          );
          micSourceRef.current.connect(bus);
        }

        const mixed = bus.stream.getAudioTracks()[0];
        if (!mixed) return null;
        return new MediaStream([...videoTracks, mixed]);
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Play a clip into the recording, and only into the recording.
   *
   * Deliberately not connected to the speakers: the candidate is already
   * hearing this from the ordinary `<audio>` element, and a second audible
   * copy would echo. Entirely best-effort — every failure path here leaves
   * the interview untouched.
   */
  const playIntoRecording = useCallback(async (url: string): Promise<void> => {
    const context = mixContextRef.current;
    const bus = mixDestinationRef.current;
    if (!context || !bus) return;

    try {
      if (context.state === "suspended") {
        // Not awaited anywhere that matters — nothing downstream of this
        // call is on the candidate's path.
        await context.resume();
      }

      let buffer = clipCacheRef.current.get(url);
      if (!buffer) {
        const response = await fetch(url);
        if (!response.ok) return;
        buffer = await context.decodeAudioData(await response.arrayBuffer());
        clipCacheRef.current.set(url, buffer);
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(bus);
      source.start();
    } catch {
      // The recording misses the question. That is the whole cost.
    }
  }, []);

  const startRecording = useCallback(async (): Promise<boolean> => {
    // Re-entry guard: never run two recordings at once.
    if (
      stateRef.current === "recording" ||
      audioRecorderRef.current?.state === "recording"
    ) {
      return false;
    }

    if (!streamRef.current) {
      const result = await requestPermission();
      if (!result.granted) return false;
    }
    const stream = streamRef.current;
    if (!stream) return false;

    const audioMime = pickMimeType(AUDIO_MIME_TYPES);
    if (!audioMime) {
      setState("unsupported");
      return false;
    }

    const videoAlreadyRolling = videoRecorderRef.current?.state === "recording";

    revokePreview();
    setPreviewUrl(null);
    setBlob(null);
    audioChunksRef.current = [];
    finishedAudioRef.current = null;
    setElapsedSeconds(0);
    if (!videoAlreadyRolling) {
      setVideoBlob(null);
      videoChunksRef.current = [];
      finishedVideoRef.current = null;
      videoRecorderRef.current = null;
    }

    // --- audio-only recorder: this is what gets transcribed ---------------
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setState("error");
      setErrorMessage("No microphone track is available.");
      return false;
    }
    const audioOnly = new MediaStream(audioTracks);

    audioSegmentsRef.current = [];
    rollingOverRef.current = false;

    /**
     * Start one segment.
     *
     * Each call makes a fresh MediaRecorder, so every segment is a complete
     * file rather than a fragment. `onstop` either rolls straight into the
     * next segment or finishes the take, depending on why it stopped.
     */
    const startSegment = (): MediaRecorder | null => {
      let segment: MediaRecorder;
      try {
        segment = new MediaRecorder(audioOnly, { mimeType: audioMime });
      } catch {
        try {
          segment = new MediaRecorder(audioOnly);
        } catch {
          setState("error");
          setErrorMessage("Recording could not be started in this browser.");
          return null;
        }
      }

      segment.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      segment.onstop = () => {
        const type = segment.mimeType || audioMime;
        const recorded = new Blob(audioChunksRef.current, { type });
        audioChunksRef.current = [];
        if (recorded.size > 0) audioSegmentsRef.current.push(recorded);

        // Mid-answer rollover: pick straight back up, do not settle.
        if (rollingOverRef.current) {
          rollingOverRef.current = false;
          const next = startSegment();
          if (next) {
            audioRecorderRef.current = next;
            next.start(1000);
          }
          return;
        }

        clearTick();
        clearSegmentTimer();

        // The last segment is what the preview plays; the transcript is
        // assembled server-side from all of them.
        const last = audioSegmentsRef.current.at(-1) ?? null;
        if (last) {
          const url = URL.createObjectURL(last);
          previewUrlRef.current = url;
          setPreviewUrl(url);
        }
        finishedAudioRef.current = last;
        setBlob(last);
        setState("recorded");
        // Devices stay open: the next question starts recording immediately.
        settleStop();
      };

      segment.onerror = () => {
        clearTick();
        clearSegmentTimer();
        rollingOverRef.current = false;
        setState("error");
        setErrorMessage("Recording stopped unexpectedly. Please try again.");
        finishedAudioRef.current = null;
        settleStop();
      };

      return segment;
    };

    const audioRecorder = startSegment();
    if (!audioRecorder) return false;

    // One for the audio recorder, plus one if the video recorder is
    // running — which it usually already is, having been started when the
    // question began playing.
    let startedRecorders = 1;
    if (videoRecorderRef.current?.state === "recording") startedRecorders += 1;

    // --- video recorder: best-effort record of the answer -----------------
    const videoMime = pickMimeType(VIDEO_MIME_TYPES);
    if (
      videoRecorderRef.current?.state !== "recording" &&
      hasCameraRef.current &&
      videoMime &&
      stream.getVideoTracks().length > 0
    ) {
      try {
        const videoRecorder = new MediaRecorder(
          buildRecordingStream(stream) ?? stream,
          {
            mimeType: videoMime,
            videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
            audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
          },
        );
        videoRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) videoChunksRef.current.push(event.data);
        };
        videoRecorder.onstop = () => {
          const type = videoRecorder.mimeType || videoMime;
          const recorded = new Blob(videoChunksRef.current, { type });
          videoChunksRef.current = [];
          finishedVideoRef.current = recorded;
          setVideoBlob(recorded);
          settleStop();
        };
        // A camera failure must not abort the answer.
        videoRecorder.onerror = () => {
          videoChunksRef.current = [];
          finishedVideoRef.current = null;
          setVideoBlob(null);
          settleStop();
        };
        videoRecorderRef.current = videoRecorder;
        videoRecorder.start(1000);
        startedRecorders += 1;
      } catch {
        videoRecorderRef.current = null;
      }
    }

    audioRecorderRef.current = audioRecorder;
    pendingStopsRef.current = startedRecorders;
    startedAtRef.current = Date.now();
    audioRecorder.start(1000);
    setState("recording");

    // Roll over before the transcription limit. The video recorder is left
    // alone: it is one continuous file and never goes near Sarvam.
    clearSegmentTimer();
    segmentTimerRef.current = setInterval(() => {
      const current = audioRecorderRef.current;
      if (!current || current.state !== "recording") return;
      rollingOverRef.current = true;
      current.stop();
    }, AUDIO_SEGMENT_SECONDS * 1000);

    clearTick();
    tickRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= maxSeconds) {
          // Hard stop at the cap so an unattended tab cannot record forever.
          if (audioRecorderRef.current?.state === "recording") {
            audioRecorderRef.current.stop();
          }
          if (videoRecorderRef.current?.state === "recording") {
            videoRecorderRef.current.stop();
          }
          maxReachedRef.current?.();
        }
        return next;
      });
    }, 1000);

    return true;
  }, [
    requestPermission,
    revokePreview,
    clearTick,
    clearSegmentTimer,
    maxSeconds,
    settleStop,
    buildRecordingStream,
  ]);

  /**
   * Begin the webcam recording for this turn, before the question is read
   * out, so the clip contains the interviewer asking it.
   *
   * Only the video starts here. The speech-to-text recorder waits for
   * `startRecording()` once the question has finished, so the transcript
   * is the candidate's answer and nothing else.
   *
   * Idempotent and best-effort: no camera, or a recorder that will not
   * start, simply means the answer is recorded from `startRecording()` as
   * before.
   */
  const startQuestionCapture = useCallback((): boolean => {
    if (videoRecorderRef.current?.state === "recording") return true;
    if (!hasCameraRef.current) return false;

    const stream = streamRef.current;
    if (!stream || stream.getVideoTracks().length === 0) return false;

    const videoMime = pickMimeType(VIDEO_MIME_TYPES);
    if (!videoMime) return false;

    videoChunksRef.current = [];
    finishedVideoRef.current = null;
    setVideoBlob(null);

    try {
      const videoRecorder = new MediaRecorder(
        buildRecordingStream(stream) ?? stream,
        {
          mimeType: videoMime,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
          audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
        },
      );

      videoRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) videoChunksRef.current.push(event.data);
      };
      videoRecorder.onstop = () => {
        const type = videoRecorder.mimeType || videoMime;
        const recorded = new Blob(videoChunksRef.current, { type });
        videoChunksRef.current = [];
        finishedVideoRef.current = recorded;
        setVideoBlob(recorded);
        settleStop();
      };
      videoRecorder.onerror = () => {
        videoChunksRef.current = [];
        finishedVideoRef.current = null;
        setVideoBlob(null);
        settleStop();
      };

      videoRecorderRef.current = videoRecorder;
      videoRecorder.start(1000);
      return true;
    } catch {
      videoRecorderRef.current = null;
      return false;
    }
  }, [settleStop, buildRecordingStream]);

  /**
   * Stop and resolve with the finished blobs.
   *
   * Awaiting this is what lets a single "Next" button stop the recording and
   * submit the answer without an intermediate review step.
   */
  const stopRecording = useCallback((): Promise<{
    audio: Blob | null;
    audioSegments: Blob[];
    video: Blob | null;
    durationMs: number;
  }> => {
    clearTick();
    // Must come first: a rollover firing between here and `stop()` would
    // start a new segment nobody is waiting on.
    clearSegmentTimer();
    rollingOverRef.current = false;
    // Wall-clock length of this take. Read here, before `reset()` can zero
    // it, because MediaRecorder's WebM carries no duration header and the
    // browser reports such a file as `Infinity` until fully played.
    const durationMs = startedAtRef.current
      ? Date.now() - startedAtRef.current
      : 0;

    const audioActive = audioRecorderRef.current?.state === "recording";
    const videoActive = videoRecorderRef.current?.state === "recording";

    /**
     * A recorder that has been told to stop but has not flushed yet.
     *
     * `MediaRecorder.stop()` flips `state` to "inactive" immediately and
     * fires `onstop` a task later, so "not recording" does NOT mean "done".
     * The duration cap stops both recorders and then asks for the blobs, so
     * without this the final audio segment and the whole video were read
     * before either had been written — a two-minute answer arrived
     * truncated and with no recording at all.
     *
     * `pendingStopsRef` counts recorders that still owe a flush; a segment
     * rollover does not touch it, so this is only true for a real stop.
     */
    const awaitingFlush = pendingStopsRef.current > 0;

    if (!audioActive && !videoActive && !awaitingFlush) {
      return Promise.resolve({
        audio: finishedAudioRef.current,
        audioSegments: audioSegmentsRef.current,
        video: finishedVideoRef.current,
        durationMs,
      });
    }

    const promise = new Promise<{
      audio: Blob | null;
      audioSegments: Blob[];
      video: Blob | null;
    }>((resolve) => {
      stopResolveRef.current = resolve;
    }).then((blobs) => ({ ...blobs, durationMs }));

    if (videoActive) videoRecorderRef.current?.stop();
    if (audioActive) audioRecorderRef.current?.stop();

    return promise;
  }, [clearTick, clearSegmentTimer]);

  /**
   * Clear the last take but KEEP the camera and microphone open, ready for the
   * next question. Use `release()` to actually hand the devices back.
   */
  const reset = useCallback(() => {
    clearTick();
    clearSegmentTimer();
    audioSegmentsRef.current = [];
    revokePreview();
    setBlob(null);
    setVideoBlob(null);
    setPreviewUrl(null);
    finishedAudioRef.current = null;
    finishedVideoRef.current = null;
    setElapsedSeconds(0);
    setErrorMessage(null);
    setState(streamRef.current ? "ready" : "idle");
  }, [clearTick, clearSegmentTimer, revokePreview]);

  /** Hand the devices back — turns off the camera light. */
  const release = useCallback(() => {
    clearTick();
    clearSegmentTimer();
    revokePreview();
    stopTracks();
    setState("idle");
  }, [clearTick, clearSegmentTimer, revokePreview, stopTracks]);

  // NOTE: `hasCameraRef` is intentionally NOT cleared by reset — the grant
  // survives between turns, and clearing it would drop video on turn 2.

  return {
    state,
    errorMessage,
    elapsedSeconds,
    blob,
    videoBlob,
    previewUrl,
    previewStream,
    stream,
    hasCamera,
    cameraError,
    isRecording: state === "recording",
    hasRecording: state === "recorded" && blob !== null,
    requestPermission,
    playIntoRecording,
    startQuestionCapture,
    startRecording,
    stopRecording,
    reset,
    release,
  };
}
