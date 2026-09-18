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
// ponytail: calibration knob. Too high and soft/normal speech dips below it
// mid-sentence, so `lastVoiceAt` goes stale and the answer submits while the
// candidate is still talking (they perceive it as "I only paused a second").
// Too low and room static counts as talking and the answer never ends. 0.013
// sits above a quiet room's floor (~0.005) while catching soft speech. Raise
// toward 0.02 only if static is holding answers open on real mics.
const SPEECH_RMS_THRESHOLD = 0.013;

/** How often the level is sampled. Fine enough for a 1s countdown. */
const SAMPLE_INTERVAL_MS = 200;

/**
 * One rung of the "they have not said anything yet" ladder.
 *
 * `at` is seconds of candidate silence, not wall clock — time spent listening
 * to the interviewer say a previous rung does not count.
 */
export interface SilenceStage {
  id: string;
  at: number;
  /** The rung that stops waiting and moves the interview on. Exactly one. */
  final?: boolean;
}

export function useSpeechActivity({
  stream,
  active,
  silenceSeconds,
  minSpeechSeconds,
  paused,
  noAnswerStages,
  onStage,
  onSpeechChange,
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
   * Freeze the clock, and stop listening, while the interviewer is talking.
   *
   * The microphone stays open through a filler so the candidate can cut in,
   * which means the interviewer's own voice reaches this analyser. Without
   * this, saying "take your time" out loud would read as the candidate
   * speaking, and the seconds spent saying it would eat the very patience it
   * was offering.
   */
  paused: boolean;
  /**
   * What to do, and when, while the candidate has not said a word.
   *
   * A ladder rather than a single deadline: reassure, then offer the question
   * more simply, then let them off the hook. Someone who has frozen is not
   * helped by the same question again, and is not helped by silence either.
   *
   * Ordered by `at`, with exactly one `final` rung — that one submits, so the
   * interview is never stuck waiting on somebody who has gone quiet. The
   * recording still goes to the transcriber, which is more sensitive than this
   * gate, and a truly empty one is skipped server-side.
   */
  noAnswerStages: SilenceStage[];
  /** Called as each rung is reached, with its id. */
  onStage: (id: string) => void;
  /**
   * Whether a word has been heard yet in this answer — `false` when watching
   * starts, `true` the first time the level clears the speech threshold.
   *
   * The one honest answer to "did this person say anything?". The transcriber
   * cannot be asked: handed near-silence it invents plausible speech, and an
   * interview once ran eight questions deep on "Okay, so" hallucinated from an
   * empty room. This is measured from the microphone, so it cannot be
   * imagined.
   */
  onSpeechChange: (heard: boolean) => void;
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

  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  }, [onStage]);

  const onSpeechChangeRef = useRef(onSpeechChange);
  useEffect(() => {
    onSpeechChangeRef.current = onSpeechChange;
  }, [onSpeechChange]);

  const stagesRef = useRef(noAnswerStages);
  useEffect(() => {
    stagesRef.current = noAnswerStages;
  }, [noAnswerStages]);

  /** Rungs already announced for this answer. */
  const doneRef = useRef<Set<string>>(new Set());

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

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
    // Each answer climbs the ladder from the bottom.
    doneRef.current = new Set();
    const startedAt = Date.now();
    let lastVoiceAt = Date.now();
    let lastTickAt = Date.now();
    /** How long the clock has stood still while the interviewer spoke. */
    let pausedMs = 0;
    let spoken = false;
    let fired = false;
    // Each answer starts from "nothing heard".
    onSpeechChangeRef.current(false);

    const timer = setInterval(() => {
      const now = Date.now();
      const sinceTick = now - lastTickAt;
      lastTickAt = now;

      // Deaf and stopped while the interviewer talks. `lastVoiceAt` moves with
      // the clock so a candidate mid-answer does not lose their pause either.
      if (pausedRef.current) {
        pausedMs += sinceTick;
        lastVoiceAt = now;
        return;
      }

      analyser.getByteTimeDomainData(samples);

      // Deviation from the 128 midpoint, as RMS in 0–1.
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);

      // One assignment per tick, so a stale countdown left over from the
      // previous answer is corrected on the first sample of this one.
      // React bails out when the value has not actually changed.
      let remaining: number | null = null;
      let waiting: number | null = null;

      if (rms >= SPEECH_RMS_THRESHOLD) {
        lastVoiceAt = now;
        if (!spoken) onSpeechChangeRef.current(true);
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
        // Not a word yet. Climb the ladder: reassure, offer it more simply,
        // then move on. Each rung fires once.
        const waited = now - startedAt - pausedMs;

        const due = stagesRef.current.find(
          (stage) =>
            stage.at * 1000 <= waited && !doneRef.current.has(stage.id),
        );
        if (due) {
          doneRef.current.add(due.id);
          if (due.final) {
            if (fired) return;
            fired = true;
            clearInterval(timer);
            setSecondsRemaining(null);
            setNoAnswerIn(null);
            onStageRef.current(due.id);
            onSilenceRef.current();
            return;
          }
          onStageRef.current(due.id);
        }

        const last = stagesRef.current[stagesRef.current.length - 1];
        waiting = last
          ? Math.max(0, Math.ceil((last.at * 1000 - waited) / 1000))
          : null;
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
  }, [stream, active, silenceSeconds, minSpeechSeconds]);

  // Guarded rather than cleared: while nothing is being watched there is no
  // countdown, whatever the last sample happened to leave behind.
  return {
    secondsRemaining: active ? secondsRemaining : null,
    noAnswerIn: active ? noAnswerIn : null,
  };
}
