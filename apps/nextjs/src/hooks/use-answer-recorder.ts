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

  const streamRef = useRef<MediaStream | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoChunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const maxReachedRef = useRef(onMaxDurationReached);
  /** Live camera feed, attached to the <video> preview element. */
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  /**
   * Resolved when both recorders have flushed. `stop()` is fire-and-forget in
   * the MediaRecorder API, so this is how a caller can await the blobs and
   * submit them in one action.
   */
  const stopResolveRef = useRef<
    ((value: { audio: Blob | null; video: Blob | null }) => void) | null
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
      video: finishedVideoRef.current,
    });
  }, []);

  useEffect(() => {
    maxReachedRef.current = onMaxDurationReached;
  }, [onMaxDurationReached]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    previewStreamRef.current = null;
    setPreviewStream(null);
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
      stopTracks();
      revokePreview();
      for (const rec of [audioRecorderRef.current, videoRecorderRef.current]) {
        if (rec && rec.state !== "inactive") rec.stop();
      }
    };
  }, [clearTick, stopTracks, revokePreview]);

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

  const startRecording = useCallback(async (): Promise<boolean> => {
    // Re-entry guard: never run two recordings at once.
    if (
      state === "recording" ||
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

    revokePreview();
    setPreviewUrl(null);
    setBlob(null);
    setVideoBlob(null);
    audioChunksRef.current = [];
    videoChunksRef.current = [];
    finishedAudioRef.current = null;
    finishedVideoRef.current = null;
    setElapsedSeconds(0);

    // --- audio-only recorder: this is what gets transcribed ---------------
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setState("error");
      setErrorMessage("No microphone track is available.");
      return false;
    }
    const audioOnly = new MediaStream(audioTracks);

    let audioRecorder: MediaRecorder;
    try {
      audioRecorder = new MediaRecorder(audioOnly, { mimeType: audioMime });
    } catch {
      try {
        audioRecorder = new MediaRecorder(audioOnly);
      } catch {
        setState("error");
        setErrorMessage("Recording could not be started in this browser.");
        return false;
      }
    }

    audioRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    audioRecorder.onstop = () => {
      clearTick();
      const type = audioRecorder.mimeType || audioMime;
      const recorded = new Blob(audioChunksRef.current, { type });
      audioChunksRef.current = [];

      const url = URL.createObjectURL(recorded);
      previewUrlRef.current = url;
      finishedAudioRef.current = recorded;
      setBlob(recorded);
      setPreviewUrl(url);
      setState("recorded");
      // Devices stay open: the next question starts recording immediately.
      settleStop();
    };
    audioRecorder.onerror = () => {
      clearTick();
      setState("error");
      setErrorMessage("Recording stopped unexpectedly. Please try again.");
      finishedAudioRef.current = null;
      settleStop();
    };

    // One for the audio recorder, plus one if the video recorder starts.
    let startedRecorders = 1;
    videoRecorderRef.current = null;

    // --- video recorder: best-effort record of the answer -----------------
    const videoMime = pickMimeType(VIDEO_MIME_TYPES);
    if (
      hasCameraRef.current &&
      videoMime &&
      stream.getVideoTracks().length > 0
    ) {
      try {
        const videoRecorder = new MediaRecorder(stream, {
          mimeType: videoMime,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
          audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
        });
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
    audioRecorder.start(1000);
    setState("recording");

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
    state,
    requestPermission,
    revokePreview,
    clearTick,
    maxSeconds,
    settleStop,
  ]);

  /**
   * Stop and resolve with the finished blobs.
   *
   * Awaiting this is what lets a single "Next" button stop the recording and
   * submit the answer without an intermediate review step.
   */
  const stopRecording = useCallback((): Promise<{
    audio: Blob | null;
    video: Blob | null;
  }> => {
    clearTick();

    const audioActive = audioRecorderRef.current?.state === "recording";
    const videoActive = videoRecorderRef.current?.state === "recording";

    if (!audioActive && !videoActive) {
      return Promise.resolve({
        audio: finishedAudioRef.current,
        video: finishedVideoRef.current,
      });
    }

    const promise = new Promise<{ audio: Blob | null; video: Blob | null }>(
      (resolve) => {
        stopResolveRef.current = resolve;
      },
    );

    if (videoActive) videoRecorderRef.current?.stop();
    if (audioActive) audioRecorderRef.current?.stop();

    return promise;
  }, [clearTick]);

  /**
   * Clear the last take but KEEP the camera and microphone open, ready for the
   * next question. Use `release()` to actually hand the devices back.
   */
  const reset = useCallback(() => {
    clearTick();
    revokePreview();
    setBlob(null);
    setVideoBlob(null);
    setPreviewUrl(null);
    finishedAudioRef.current = null;
    finishedVideoRef.current = null;
    setElapsedSeconds(0);
    setErrorMessage(null);
    setState(streamRef.current ? "ready" : "idle");
  }, [clearTick, revokePreview]);

  /** Hand the devices back — turns off the camera light. */
  const release = useCallback(() => {
    clearTick();
    revokePreview();
    stopTracks();
    setState("idle");
  }, [clearTick, revokePreview, stopTracks]);

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
    hasCamera,
    cameraError,
    isRecording: state === "recording",
    hasRecording: state === "recorded" && blob !== null,
    requestPermission,
    startRecording,
    stopRecording,
    reset,
    release,
  };
}
