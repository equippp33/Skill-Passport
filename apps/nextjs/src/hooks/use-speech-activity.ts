"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Notice when the candidate has stopped talking.
 *
 * Reads the microphone level straight off the live stream with an
 * AnalyserNode — no recognition, no network, nothing recorded. It exists so
 * the interview can move on by itself when someone finishes an answer and
 * waits, which is what people do in a real conversation rather than
 * hunting for a button.
 *
 * Two guards stop it firing at the wrong moment:
 *  - it will not fire until the candidate has actually said something, so
 *    silence while they gather their thoughts never skips the question;
 *  - it will not fire before `minSpeechSeconds`, so a cough or a one-word
 *    false start cannot submit the answer.
 *
 * `secondsRemaining` is surfaced so the UI can count down. Advancing without
 * warning feels like a crash; a visible countdown that resets the moment
 * they speak again feels like being listened to.
 */

/**
 * RMS amplitude, 0–1, above which we call it speech.
 *
 * Set well above a typical room's noise floor: with gain control off (see the
 * recorder) background hiss and static sit low, and only speech loud enough to
 * be transcribed clearly clears this bar — so a noisy room no longer holds the
 * answer open forever. Tune here if real speech is being missed or noise still
 * counts as talking.
 */
const SPEECH_RMS_THRESHOLD = 0.02;

/** How often the level is sampled. Fine enough for a 1s countdown. */
const SAMPLE_INTERVAL_MS = 200;

export function useSpeechActivity({
  stream,
  active,
  silenceSeconds,
  minSpeechSeconds,
  maxWaitSeconds,
  onSilence,
}: {
  /** The live microphone stream. Null while devices are not open. */
  stream: MediaStream | null;
  /** Only watch while an answer is actually being recorded. */
  active: boolean;
  /** Silence this long after speech ends triggers `onSilence`. */
  silenceSeconds: number;
  /** Never fire before the answer is at least this long. */
  minSpeechSeconds: number;
  /**
   * If the candidate never says anything, give up after this long and submit
   * anyway rather than waiting forever — the recording still goes to the
   * transcriber, which is more sensitive than this gate, and a truly empty one
   * is skipped server-side.
   */
  maxWaitSeconds: number;
  onSilence: () => void;
}): { secondsRemaining: number | null; noAnswerIn: number | null } {
  /**
   * Written only from the sampling interval, and read back through the
   * `active` guard below rather than being reset when watching stops —
   * clearing it here would mean a setState in the effect body, and the
   * guard makes the same guarantee without one.
   */
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  /** Seconds until we give up waiting for a first word; null once they speak. */
  const [noAnswerIn, setNoAnswerIn] = useState<number | null>(null);

  // Held in a ref so a new callback identity on every render does not tear
  // down and rebuild the audio graph.
  const onSilenceRef = useRef(onSilence);
  useEffect(() => {
    onSilenceRef.current = onSilence;
  }, [onSilence]);

  useEffect(() => {
    if (!active || !stream) return;
    if (stream.getAudioTracks().length === 0) return;

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    let context: AudioContext;
    try {
      context = new AudioCtx();
    } catch {
      // Analysis is an enhancement; the Next button still works without it.
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    // Deliberately NOT connected to the destination — routing the microphone
    // to the speakers would feed it straight back into the recording.

    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();
    let lastVoiceAt = Date.now();
    let spoken = false;
    let fired = false;

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);

      // Deviation from the 128 midpoint, as RMS in 0–1.
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();

      // One assignment per tick, so a stale countdown left over from the
      // previous answer is corrected on the first sample of this one.
      // React bails out when the value has not actually changed.
      let remaining: number | null = null;
      let waiting: number | null = null;

      if (rms >= SPEECH_RMS_THRESHOLD) {
        lastVoiceAt = now;
        spoken = true;
      } else if (spoken && now - startedAt >= minSpeechSeconds * 1000) {
        // They spoke and have now gone quiet — the normal end of an answer.
        const silentMs = now - lastVoiceAt;
        const left = Math.ceil((silenceSeconds * 1000 - silentMs) / 1000);

        if (left <= 0) {
          if (fired) return;
          fired = true;
          clearInterval(timer);
          setSecondsRemaining(null);
          setNoAnswerIn(null);
          onSilenceRef.current();
          return;
        }
        remaining = left;
      } else if (!spoken) {
        // Not a word yet — count down to giving up, and submit when it runs
        // out so the interview is never stuck waiting on someone silent.
        const left = Math.ceil((maxWaitSeconds * 1000 - (now - startedAt)) / 1000);

        if (left <= 0) {
          if (fired) return;
          fired = true;
          clearInterval(timer);
          setSecondsRemaining(null);
          setNoAnswerIn(null);
          onSilenceRef.current();
          return;
        }
        waiting = left;
      }

      setSecondsRemaining(remaining);
      setNoAnswerIn(waiting);
    }, SAMPLE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [stream, active, silenceSeconds, minSpeechSeconds, maxWaitSeconds]);

  // Guarded rather than cleared: while nothing is being watched there is no
  // countdown, whatever the last sample happened to leave behind.
  return {
    secondsRemaining: active ? secondsRemaining : null,
    noAnswerIn: active ? noAnswerIn : null,
  };
}
