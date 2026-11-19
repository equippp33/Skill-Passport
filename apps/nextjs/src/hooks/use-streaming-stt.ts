"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Realtime speech-to-text over the WebSocket relay.
 *
 * Replaces the local microphone-VAD guesswork: the candidate's audio is
 * streamed to Sarvam (via our relay, so the key stays server-side) and Sarvam's
 * own voice-activity detection decides when they have finished.
 *
 * Sarvam invents sentences out of silence and faint noise, so it is never sent
 * the room: the voice gate (VOICE_RMS_FLOOR) replaces every chunk without a
 * real voice in it with digital silence before it leaves the browser.
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

/**
 * The voice gate: Sarvam only ever hears the candidate's VOICE, never the room.
 *
 * Fed silence or faint noise, the speech model does not return nothing — it
 * invents a stock sentence ("Okay, so I'm going to try and connect this to the
 * phone") and that was being scored as the answer. So each ~100ms chunk is
 * measured here first: a chunk clearly louder than the room is sent as is, and
 * any other chunk is sent as the same length of pure digital silence (zeros).
 *
 * Zeros rather than nothing, deliberately. Sarvam's own VAD needs to HEAR the
 * silence after speech to emit `vad.speech_end` and `transcript.final`, the
 * silence ladder runs on those events, and an idle socket gets cut. Zeros keep
 * the stream continuous with true timing, but give the model nothing to
 * transcribe. The recorder is separate and still archives the real audio.
 *
 * "Clearly louder than the room" = VOICE_NOISE_MULTIPLIER × the QUIETEST chunk
 * of the last NOISE_WINDOW_CHUNKS, kept between the floor and ceiling. Speech
 * has gaps between words, so the quietest recent chunk is the room even while
 * someone talks, and a fan or hum raises the bar so it never opens the gate on
 * its own. Same floor/ceiling as the batch path's detector (use-speech-activity).
 */
const VOICE_RMS_FLOOR = 0.008;
const VOICE_RMS_CEILING = 0.06;
const VOICE_NOISE_MULTIPLIER = 3;
/** ~3s of 100ms chunks — long enough to always contain a pause. */
const NOISE_WINDOW_CHUNKS = 30;
/** Chunks (~1s) measured before the room's own noise is trusted over the floor. */
const NOISE_WARMUP_CHUNKS = 10;
/**
 * The last few chunks before the gate opens, re-sent as real audio when it
 * does, so the first syllable ("Mmy name…") is not lost to the loudness check
 * catching up. (They already went out as zeros; Sarvam just sees ~0.3s more
 * audio, which does not matter to it.)
 */
const PRE_ROLL_CHUNKS = 3;
/**
 * Chunks still sent for real after the voice drops below the bar, so word
 * endings and soft consonants are not clipped.
 */
const HANGOVER_CHUNKS = 5;

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

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
  onUtterance,
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
  /**
   * Everything the candidate has said on this turn so far, after each
   * completed utterance.
   *
   * Exists so a spoken REQUEST — "say that again", "skip this one" — can be
   * acted on the moment it is heard, instead of sitting there until the
   * candidate presses Next. Asking someone to press Next to have their "can
   * you repeat that?" noticed rather defeats the asking.
   *
   * The whole transcript rather than the latest fragment, deliberately: the
   * phrase lists only match utterances of a few words, so a real answer is
   * automatically too long to be mistaken for a request.
   */
  onUtterance?: (fullTranscript: string) => void;
  onSilenceStage?: (index: number, hasSpoken: boolean) => void;
  /** The whole answer, once the candidate has finished the turn. */
  onFinalTurn: (transcript: string) => void;
  /** The relay/upstream failed — caller should fall back to the batch path. */
  onFailed?: () => void;
}): {
  partial: string;
  connected: boolean;
  silentSeconds: number | null;
  /**
   * Keep listening on the SAME turn after `onFinalTurn` fired — used by the
   * "would you like to add?" flow: the pause is not the end, so re-arm and let
   * the next pause fire `onFinalTurn` again with only what they add next.
   */
  rearm: () => void;
  /**
   * The whole answer heard so far on this turn (stitched finals + the live
   * partial), read on demand. The manual "Next" button uses this to submit
   * exactly what has been said when the candidate decides they are done, rather
   * than relying on the VAD to guess the end.
   */
  getTranscript: () => string;
} {
  const [partial, setPartial] = useState("");
  const [connected, setConnected] = useState(false);
  const [silentSeconds, setSilentSeconds] = useState<number | null>(null);
  const rearmRef = useRef<() => void>(() => undefined);
  // The stitched answer, kept in a ref so the button can read it without a
  // re-render on every partial.
  const transcriptRef = useRef("");

  const onFinalTurnRef = useRef(onFinalTurn);
  const onSpeechStartRef = useRef(onSpeechStart);
  const onUtteranceRef = useRef(onUtterance);
  const onSilenceStageRef = useRef(onSilenceStage);
  const onFailedRef = useRef(onFailed);
  const speakingRef = useRef(speaking);
  useEffect(() => {
    onFinalTurnRef.current = onFinalTurn;
    onSpeechStartRef.current = onSpeechStart;
    onUtteranceRef.current = onUtterance;
    onSilenceStageRef.current = onSilenceStage;
    onFailedRef.current = onFailed;
    speakingRef.current = speaking;
  }, [
    onFinalTurn,
    onSpeechStart,
    onUtterance,
    onSilenceStage,
    onFailed,
    speaking,
  ]);

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
    /**
     * A new session hears nothing until it hears something.
     *
     * `finals` is created fresh for every session, but `transcriptRef` lives
     * on the hook and survived every one of them — the cleanup below closes
     * the socket and stops the timers and never touched it. So each question
     * opened still holding the LAST question's answer, readable through
     * `getTranscript`. Silence read as having answered; the countdown then
     * submitted those old words again, and one reply was scored against
     * every question that followed it.
     *
     * Cleared here, at the source, so no caller has to remember to. (The
     * on-screen caption is state and cannot be reset inside an effect; it is
     * cleared by `rearm` when the new question begins.)
     */
    transcriptRef.current = "";
    let firedTurn = false;
    // The last moment the interviewer was speaking. We keep muting the stream
    // for a short window AFTER their clip ends, so the echo/tail bleeding from
    // the speakers into the mic is never transcribed as the candidate's answer
    // (which was making short follow-ups auto-submit on the AI's own voice).
    let lastSpeakingAt = Date.now();

    /**
     * The no-answer ladder.
     *
     * Silence is measured from when the candidate last STOPPED speaking, not
     * from when recording began, and the rungs re-arm every time they speak
     * again. This used to be a one-way latch — a single `vad.speech_start`
     * set `spoke = true` and disabled the ladder for the rest of the question.
     * One cough, one "umm", or the student literally saying "can you repeat
     * that?" was enough: after that they could sit in silence indefinitely and
     * nothing would ever check on them, prompt them, or move the interview on.
     *
     * `everSpoke` is kept separately because it answers a different question.
     * Somebody who has said nothing needs "did you understand the question?";
     * somebody who answered and then went quiet does not — they need the
     * backstop that eventually moves things along. The caller decides, so both
     * facts are handed to it.
     */
    let gateStats = { voice: 0, silenced: 0 };
    const startedAt = Date.now();
    let talking = false;
    let everSpoke = false;
    let quietSince = startedAt;
    const firedSilenceStages = new Set<number>();

    const fireTurn = () => {
      if (firedTurn) return;
      firedTurn = true;
      onFinalTurnRef.current(finals.join(" ").replace(/\s+/g, " ").trim());
    };

    // Re-arm: allow another fire and drop the finals so the NEXT stretch of
    // speech is captured on its own (used to move between the opening bits).
    rearmRef.current = () => {
      firedTurn = false;
      finals.length = 0;
      transcriptRef.current = "";
      setPartial("");
      // Each opening bit (and each re-ask) is a FRESH prompt, so restart the
      // silence ladder: every part gets its own patient check-in and give-up
      // window instead of inheriting "already nudged / already gave up" from
      // the part before. Without this, only the first silent bit was ever
      // nudged and the rest were hurried along in silence.
      firedSilenceStages.clear();
      quietSince = Date.now();
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
          // Arrived after this session was torn down: whatever it says, it is
          // not an answer to the question now on screen.
          if (cancelled) return;
          let msg: { event?: string; text?: string; is_fatal?: boolean };
          try {
            msg = JSON.parse(event.data) as typeof msg;
          } catch {
            return;
          }
          switch (msg.event) {
            case "vad.speech_start":
              // Speaking now: pause the ladder and let every rung arm again,
              // so the next stretch of silence is treated on its own merits
              // rather than as a continuation of one already handled.
              talking = true;
              everSpoke = true;
              firedSilenceStages.clear();
              setSilentSeconds(null);
              if (turnEndTimer) {
                clearTimeout(turnEndTimer);
                turnEndTimer = null;
              }
              onSpeechStartRef.current?.();
              break;
            case "transcript.partial":
              if (typeof msg.text === "string") {
                setPartial(msg.text);
                transcriptRef.current = [...finals, msg.text]
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim();
              }
              break;
            case "transcript.final":
              if (msg.text && msg.text.trim()) finals.push(msg.text.trim());
              setPartial("");
              transcriptRef.current = finals
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
              onUtteranceRef.current?.(transcriptRef.current);
              break;
            case "vad.speech_end":
              // Quiet again: this is the moment the silence clock restarts.
              talking = false;
              quietSince = Date.now();
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

        // Voice-gate state (see VOICE_RMS_FLOOR). For the first
        // NOISE_WARMUP_CHUNKS the bar is the plain floor, so a candidate who
        // starts talking the instant the question ends is not measured against
        // their own voice before any pause has been heard. Only that long,
        // though: kept longer, a fan would open the gate until it aged out.
        const recentRms: number[] = [];
        let preRoll: Float32Array[] = [];
        let hangover = 0;
        // For the dev console: how much of this turn actually reached Sarvam.
        gateStats = { voice: 0, silenced: 0 };

        /** Resample once, then send in frames under Sarvam's per-frame cap. */
        const sendPcm = (pcm: Int16Array) => {
          for (let i = 0; i < pcm.length; i += MAX_FRAME_SAMPLES) {
            const frame = pcm.subarray(i, i + MAX_FRAME_SAMPLES);
            ws!.send(
              JSON.stringify({
                event: "audio_input",
                audio: pcm16ToBase64(frame),
              }),
            );
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

          // Voice gate: is this chunk clearly louder than the room?
          const level = rmsOf(merged);
          recentRms.push(level);
          if (recentRms.length > NOISE_WINDOW_CHUNKS) recentRms.shift();
          const roomNoise =
            recentRms.length < NOISE_WARMUP_CHUNKS ? 0 : Math.min(...recentRms);
          const threshold = Math.min(
            VOICE_RMS_CEILING,
            Math.max(VOICE_RMS_FLOOR, roomNoise * VOICE_NOISE_MULTIPLIER),
          );

          if (level >= threshold) {
            // Gate opening: send the held-back lead-in first, in order.
            for (const held of preRoll) sendPcm(resampleToPcm16(held, inRate));
            preRoll = [];
            hangover = HANGOVER_CHUNKS;
            gateStats.voice += 1;
            sendPcm(resampleToPcm16(merged, inRate));
          } else if (hangover > 0) {
            // Just after speech: still the real audio, for the word's tail.
            hangover -= 1;
            gateStats.voice += 1;
            sendPcm(resampleToPcm16(merged, inRate));
          } else {
            gateStats.silenced += 1;
            // The room, not the candidate: send the same length of silence,
            // and keep the chunk as possible lead-in for the next word.
            preRoll.push(merged);
            if (preRoll.length > PRE_ROLL_CHUNKS) preRoll.shift();
            sendPcm(
              new Int16Array(
                Math.floor((merged.length * TARGET_SAMPLE_RATE) / inRate),
              ),
            );
          }
        }, FLUSH_MS);

        // No-answer ladder: escalate while the candidate has said nothing.
        silenceTimer = setInterval(() => {
          /**
           * The clock only runs while the candidate could actually be heard.
           *
           * It used to start when RECORDING started, which is while the
           * question is still being read out. By the time the candidate had
           * heard the question, several seconds of "their" silence had
           * already elapsed — so the whole ladder fired at once and they were
           * asked "would you like to add anything?" before they had been
           * asked anything at all.
           *
           * Held back for the settle window too: the flush loop drops those
           * frames so the speakers are not transcribed as the candidate, and
           * silence nobody is listening to is not silence they chose.
           */
          if (
            speakingRef.current ||
            Date.now() - lastSpeakingAt < POST_SPEAK_MUTE_MS
          ) {
            quietSince = Date.now();
            return;
          }
          // Mid-sentence: not silence.
          if (talking) return;
          const elapsed = Math.floor((Date.now() - quietSince) / 1000);
          setSilentSeconds(elapsed);
          for (let i = 0; i < noAnswerStages.length; i += 1) {
            if (elapsed >= noAnswerStages[i]! && !firedSilenceStages.has(i)) {
              firedSilenceStages.add(i);
              onSilenceStageRef.current?.(i, everSpoke);
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
      if (gateStats.voice + gateStats.silenced > 0) {
        console.info(
          `[stt] voice gate: sent ${gateStats.voice} voice chunks, silenced ${gateStats.silenced} (~100ms each)`,
        );
      }
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

  return {
    partial,
    connected,
    silentSeconds,
    rearm: () => rearmRef.current(),
    getTranscript: () => transcriptRef.current,
  };
}
