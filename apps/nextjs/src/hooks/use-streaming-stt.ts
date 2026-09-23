"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Realtime speech-to-text over the WebSocket relay.
 *
 * Replaces the local microphone-VAD guesswork: the candidate's audio is
 * streamed to Sarvam (via our relay, so the key stays server-side) and Sarvam's
 * own voice-activity detection decides when they have finished — no amplitude
 * threshold to tune, and it never transcribes a silent tail, so the hallucinated
 * garbage the batch endpoint produced is gone.
 *
 * Two layers of endpointing:
 *  - Sarvam segments speech into utterances on ~1s of silence and returns a
 *    `transcript.final` for each.
 *  - This hook stitches those finals together and only calls the TURN finished
 *    once the candidate has been quiet for `turnSilenceMs` with no new speech —
 *    so a pause for thought mid-answer does not submit half an answer.
 */

const TARGET_SAMPLE_RATE = 16000;
/** ~100ms of 16k audio per relay message, matching the probe that verified it. */
const FLUSH_MS = 100;
/**
 * Max samples per `audio_input` message. Sarvam's `fast` stream caps each frame
 * at 16000 BYTES (8000 linear16 samples); 1600 samples = 3200 bytes keeps every
 * frame comfortably under that, whatever the flush accumulated (a throttled
 * timer can hand us a full second at once). Larger frames get rejected with
 * `chunk_too_large`, which used to tear the whole stream down.
 */
const MAX_FRAME_SAMPLES = 1600;
/**
 * How long to keep muting the stream AFTER the interviewer's clip ends, to let
 * the speaker→mic echo die out before we start listening. Short enough that a
 * quick candidate is not clipped, long enough that the AI's own tail is not
 * transcribed as their answer.
 */
const POST_SPEAK_MUTE_MS = 700;

/** Float32 at `inRate` → linear16 PCM resampled to 16kHz. */
function resampleToPcm16(float32: Float32Array, inRate: number): Int16Array {
  let data = float32;
  if (inRate !== TARGET_SAMPLE_RATE) {
    const ratio = inRate / TARGET_SAMPLE_RATE;
    const outLen = Math.floor(float32.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, float32.length - 1);
      out[i] = float32[i0]! + (float32[i1]! - float32[i0]!) * (idx - i0);
    }
    data = out;
  }
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const s = Math.max(-1, Math.min(1, data[i]!));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

/** Base64 of one (already-small) linear16 frame. */
function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function useStreamingStt({
  stream,
  active,
  languageCode,
  relayUrl,
  speaking = false,
  turnSilenceMs = 2500,
  noAnswerStages = [],
  onSpeechStart,
  onSilenceStage,
  onFinalTurn,
  onFailed,
}: {
  stream: MediaStream | null;
  /** Stream to the relay only while an answer is being given. */
  active: boolean;
  /** BCP-47 code for the locked interview language, e.g. "en-IN". */
  languageCode: string;
  /** WebSocket origin of the relay (no trailing slash, no path). */
  relayUrl: string;
  /**
   * True while the INTERVIEWER is speaking (question, filler, nudge, check-in).
   * Audio is not sent upstream then, so the clip is never transcribed as the
   * candidate's answer.
   */
  speaking?: boolean;
  /** Silence after the last speech before the turn is called finished. */
  turnSilenceMs?: number;
  /**
   * Seconds of total silence (candidate has said nothing yet) at which to
   * escalate. `onSilenceStage(i)` fires once as each is crossed — the caller
   * checks understanding, warns, then skips. Reset the moment they speak.
   */
  noAnswerStages?: number[];
  onSpeechStart?: () => void;
  onSilenceStage?: (index: number) => void;
  /** The whole answer, once the candidate has finished the turn. */
  onFinalTurn: (transcript: string) => void;
  /** The relay/upstream failed — caller should fall back to the batch path. */
  onFailed?: () => void;
}): { partial: string; connected: boolean; silentSeconds: number | null } {
  const [partial, setPartial] = useState("");
  const [connected, setConnected] = useState(false);
  const [silentSeconds, setSilentSeconds] = useState<number | null>(null);

  const onFinalTurnRef = useRef(onFinalTurn);
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSilenceStageRef = useRef(onSilenceStage);
  const onFailedRef = useRef(onFailed);
  const speakingRef = useRef(speaking);
  useEffect(() => {
    onFinalTurnRef.current = onFinalTurn;
    onSpeechStartRef.current = onSpeechStart;
    onSilenceStageRef.current = onSilenceStage;
    onFailedRef.current = onFailed;
    speakingRef.current = speaking;
  }, [onFinalTurn, onSpeechStart, onSilenceStage, onFailed, speaking]);

  useEffect(() => {
    if (!active || !stream || !relayUrl) return;
    if (stream.getAudioTracks().length === 0) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let context: AudioContext | null = null;
    let node: AudioWorkletNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let turnEndTimer: ReturnType<typeof setTimeout> | null = null;
    let silenceTimer: ReturnType<typeof setInterval> | null = null;

    // Accumulated mic samples awaiting the next flush, and the stitched answer.
    let pending: Float32Array[] = [];
    let pendingLen = 0;
    const finals: string[] = [];
    let firedTurn = false;
    // The last moment the interviewer was speaking. We keep muting the stream
    // for a short window AFTER their clip ends, so the echo/tail bleeding from
    // the speakers into the mic is never transcribed as the candidate's answer
    // (which was making short follow-ups auto-submit on the AI's own voice).
    let lastSpeakingAt = Date.now();

    // The no-answer ladder: runs until the candidate first speaks. Elapsed time
    // since recording started; each stage fires once. Reset on speech_start.
    const startedAt = Date.now();
    let spoke = false;
    const firedSilenceStages = new Set<number>();

    const fireTurn = () => {
      if (firedTurn) return;
      firedTurn = true;
      onFinalTurnRef.current(finals.join(" ").replace(/\s+/g, " ").trim());
    };

    const start = async () => {
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        context = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE });
        await context.resume().catch(() => undefined);
        await context.audioWorklet.addModule("/stt-worklet.js");
        if (cancelled) return;

        const inRate = context.sampleRate;
        source = context.createMediaStreamSource(stream);
        node = new AudioWorkletNode(context, "pcm-forwarder");
        source.connect(node);
        // Kept in the graph so it is pulled, but it writes no output — silent.
        node.connect(context.destination);

        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          pending.push(e.data);
          pendingLen += e.data.length;
        };

        ws = new WebSocket(
          `${relayUrl}/stt-stream?language_code=${encodeURIComponent(
            languageCode,
          )}`,
        );
        ws.onopen = () => !cancelled && setConnected(true);
        ws.onerror = () => {
          if (!cancelled) onFailedRef.current?.();
        };
        ws.onclose = () => !cancelled && setConnected(false);
        ws.onmessage = (event: MessageEvent<string>) => {
          let msg: { event?: string; text?: string; is_fatal?: boolean };
          try {
            msg = JSON.parse(event.data) as typeof msg;
          } catch {
            return;
          }
          switch (msg.event) {
            case "vad.speech_start":
              // They spoke — end the no-answer ladder for good and clear any
              // pending turn-end from an earlier pause.
              spoke = true;
              setSilentSeconds(null);
              if (turnEndTimer) {
                clearTimeout(turnEndTimer);
                turnEndTimer = null;
              }
              onSpeechStartRef.current?.();
              break;
            case "transcript.partial":
              if (typeof msg.text === "string") setPartial(msg.text);
              break;
            case "transcript.final":
              if (msg.text && msg.text.trim()) finals.push(msg.text.trim());
              setPartial("");
              break;
            case "vad.speech_end":
              // End the turn only if they stay quiet — a pause for thought
              // that resumes cancels this via the next speech_start.
              if (turnEndTimer) clearTimeout(turnEndTimer);
              turnEndTimer = setTimeout(fireTurn, turnSilenceMs);
              break;
            case "error":
              // Sarvam flags recoverable errors with is_fatal:false (e.g. a
              // single oversized frame). Only a FATAL error should drop us to
              // the batch fallback — a non-fatal one is logged and ignored so a
              // transient hiccup does not kill the whole turn's streaming.
              if (msg.is_fatal === false) {
                console.warn("[stt] non-fatal Sarvam error, continuing");
              } else if (!cancelled) {
                onFailedRef.current?.();
              }
              break;
            default:
              break;
          }
        };

        // Flush accumulated audio at a steady cadence, ~100ms per message.
        flushTimer = setInterval(() => {
          // Do not stream while the interviewer's own clip is playing — nor for
          // a short settle window after it ends, so the speaker→mic echo is not
          // transcribed as the candidate's answer.
          if (speakingRef.current) {
            lastSpeakingAt = Date.now();
            pending = [];
            pendingLen = 0;
            return;
          }
          if (Date.now() - lastSpeakingAt < POST_SPEAK_MUTE_MS) {
            pending = [];
            pendingLen = 0;
            return;
          }
          if (!ws || ws.readyState !== WebSocket.OPEN || pendingLen === 0)
            return;
          const merged = new Float32Array(pendingLen);
          let offset = 0;
          for (const frame of pending) {
            merged.set(frame, offset);
            offset += frame.length;
          }
          pending = [];
          pendingLen = 0;
          // Resample once, then send in frames small enough that even a full
          // second handed over by a throttled timer never trips Sarvam's
          // per-frame cap.
          const pcm = resampleToPcm16(merged, inRate);
          for (let i = 0; i < pcm.length; i += MAX_FRAME_SAMPLES) {
            const frame = pcm.subarray(i, i + MAX_FRAME_SAMPLES);
            ws.send(
              JSON.stringify({ event: "audio_input", audio: pcm16ToBase64(frame) }),
            );
          }
        }, FLUSH_MS);

        // No-answer ladder: escalate while the candidate has said nothing.
        silenceTimer = setInterval(() => {
          if (spoke) return;
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          setSilentSeconds(elapsed);
          for (let i = 0; i < noAnswerStages.length; i += 1) {
            if (elapsed >= noAnswerStages[i]! && !firedSilenceStages.has(i)) {
              firedSilenceStages.add(i);
              onSilenceStageRef.current?.(i);
            }
          }
        }, 500);
      } catch {
        if (!cancelled) onFailedRef.current?.();
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (turnEndTimer) clearTimeout(turnEndTimer);
      if (silenceTimer) clearInterval(silenceTimer);
      if (node) node.port.onmessage = null;
      try {
        source?.disconnect();
        node?.disconnect();
      } catch {
        // best-effort teardown
      }
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
      void context?.close().catch(() => undefined);
      setConnected(false);
      setPartial("");
      setSilentSeconds(null);
    };
  }, [stream, active, languageCode, relayUrl, turnSilenceMs, noAnswerStages]);

  return { partial, connected, silentSeconds };
}
