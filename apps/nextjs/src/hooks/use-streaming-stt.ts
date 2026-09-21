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

/** Float32 → resampled linear16 → base64, ready for one `audio_input` message. */
function encodeChunk(float32: Float32Array, inRate: number): string {
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
  const bytes = new Uint8Array(pcm.buffer);
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
  turnSilenceMs = 2500,
  onSpeechStart,
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
  /** Silence after the last speech before the turn is called finished. */
  turnSilenceMs?: number;
  onSpeechStart?: () => void;
  /** The whole answer, once the candidate has finished the turn. */
  onFinalTurn: (transcript: string) => void;
  /** The relay/upstream failed — caller should fall back to the batch path. */
  onFailed?: () => void;
}): { partial: string; connected: boolean } {
  const [partial, setPartial] = useState("");
  const [connected, setConnected] = useState(false);

  const onFinalTurnRef = useRef(onFinalTurn);
  const onSpeechStartRef = useRef(onSpeechStart);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onFinalTurnRef.current = onFinalTurn;
    onSpeechStartRef.current = onSpeechStart;
    onFailedRef.current = onFailed;
  }, [onFinalTurn, onSpeechStart, onFailed]);

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

    // Accumulated mic samples awaiting the next flush, and the stitched answer.
    let pending: Float32Array[] = [];
    let pendingLen = 0;
    const finals: string[] = [];
    let firedTurn = false;

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
          let msg: { event?: string; text?: string };
          try {
            msg = JSON.parse(event.data) as typeof msg;
          } catch {
            return;
          }
          switch (msg.event) {
            case "vad.speech_start":
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
              if (!cancelled) onFailedRef.current?.();
              break;
            default:
              break;
          }
        };

        // Flush accumulated audio at a steady cadence, ~100ms per message.
        flushTimer = setInterval(() => {
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
          ws.send(
            JSON.stringify({
              event: "audio_input",
              audio: encodeChunk(merged, inRate),
            }),
          );
        }, FLUSH_MS);
      } catch {
        if (!cancelled) onFailedRef.current?.();
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (turnEndTimer) clearTimeout(turnEndTimer);
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
    };
  }, [stream, active, languageCode, relayUrl, turnSilenceMs]);

  return { partial, connected };
}
