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
/**
 * The FLOOR for the speech threshold — it never drops below this even in a
 * silent room, so faint hiss is never mistaken for a voice.
 */
const SPEECH_RMS_FLOOR = 0.008;

/**
 * The CEILING for it — even a loud room never demands more than this, so the
 * candidate is not forced to shout to be heard.
 */
const SPEECH_RMS_CEILING = 0.06;

/**
 * Speech must beat the measured room noise by this factor. A fan or background
 * chatter sits at the noise floor; a real voice is several times louder, so
 * requiring 2.5× the ambient level is what separates the two — and it adapts
 * per room instead of guessing one number that works nowhere.
 */
const NOISE_MULTIPLIER = 2.5;

/** How often the level is sampled. Fine enough for a 1s countdown. */
const SAMPLE_INTERVAL_MS = 200;

/**
 * Net voiced time before we believe the candidate is actually answering.
 *
 * Built up while a real voice is present and decayed twice as fast during
 * silence, so a cough, a knock, or an intermittent bit of noise can never
 * accumulate to this — only genuine, sustained speech does. Until it is
 * reached, nothing auto-submits and the "take your time" nudge still fires.
 */
const VOICE_ARM_MS = 1000;

export function useSpeechActivity({
  stream,
  active,
  speaking = false,
  silenceSeconds,
  minSpeechSeconds,
  noAnswerStages,
  onNoAnswerStage,
  onSilence,
}: {
  /** The live microphone stream. Null while devices are not open. */
  stream: MediaStream | null;
  /** Only watch while an answer is actually being recorded. */
  active: boolean;
  /**
   * True while the INTERVIEWER is speaking (question, filler, nudge). Detection
   * pauses so the clip bleeding into the mic is never mistaken for an answer.
   */
  speaking?: boolean;
  /** Silence this long after speech ends triggers `onSilence`. */
  silenceSeconds: number;
  /** Never fire before the answer is at least this long. */
  minSpeechSeconds: number;
  /**
   * When the candidate has said nothing, escalate through these thresholds (in
   * seconds, ascending): `onNoAnswerStage(i)` fires once as each is crossed.
   * The caller decides what each stage does — nudge, repeat, then move on — so
   * a silent candidate is coaxed rather than left in dead air.
   */
  noAnswerStages: number[];
  onNoAnswerStage: (index: number) => void;
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
  const onNoAnswerStageRef = useRef(onNoAnswerStage);
  useEffect(() => {
    onNoAnswerStageRef.current = onNoAnswerStage;
  }, [onNoAnswerStage]);
  // Read inside the sampling loop rather than being an effect dependency, so
  // the interviewer starting to speak does not tear down and rebuild the graph.
  const speakingRef = useRef(speaking);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

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
    // Autoplay policy can hand back a SUSPENDED context. A suspended analyser
    // returns pure silence, so `spoken` never becomes true and the no-answer
    // ladder fires on a timer while the candidate is actually talking — the
    // "why is it nudging me mid-answer" bug. Resuming makes detection real.
    void context.resume().catch(() => undefined);

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
    // What this room's own noise is measuring right now. Learned from the quiet
    // moments and used to set the bar speech has to clear, so a noisy room and
    // a silent one both work without a hand-tuned number.
    let noiseFloor = 0.02;
    // Net voiced time: ramps up on real speech, decays faster on silence, so a
    // blip of noise never accumulates into "they answered".
    let voicedMs = 0;
    let spoken = false;
    let fired = false;
    const firedStages = new Set<number>();

    const timer = setInterval(() => {
      // The interviewer is talking (question replay, filler, "take your time"):
      // do not listen. The clip leaks into the mic, and counting it as the
      // candidate answering was auto-submitting empty answers. Pause in place —
      // the timers and `spoken` survive so nothing resets underneath them.
      if (speakingRef.current) return;

      analyser.getByteTimeDomainData(samples);

      // Deviation from the 128 midpoint, as RMS in 0–1.
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();

      // The bar speech has to clear: well above the measured room noise, but
      // clamped so a quiet room is not deaf and a loud one needs no shouting.
      const threshold = Math.min(
        SPEECH_RMS_CEILING,
        Math.max(SPEECH_RMS_FLOOR, noiseFloor * NOISE_MULTIPLIER),
      );

      // One assignment per tick, so a stale countdown left over from the
      // previous answer is corrected on the first sample of this one.
      // React bails out when the value has not actually changed.
      let remaining: number | null = null;
      let waiting: number | null = null;

      if (rms >= threshold) {
        voicedMs = Math.min(VOICE_ARM_MS, voicedMs + SAMPLE_INTERVAL_MS);
        lastVoiceAt = now;
        // Latches once enough real voice has accumulated; a single loud sample
        // (cough, knock, static) never gets there.
        if (voicedMs >= VOICE_ARM_MS) spoken = true;
      } else {
        // Learn the ambient level from the quiet stretches only.
        noiseFloor = noiseFloor * 0.9 + rms * 0.1;
        // Decay twice as fast as it builds, so intermittent noise cannot creep
        // up to the arm threshold between gaps.
        voicedMs = Math.max(0, voicedMs - SAMPLE_INTERVAL_MS * 2);

        if (spoken && now - startedAt >= minSpeechSeconds * 1000) {
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
          // Not a word yet — escalate through the nudge stages. Each fires
          // once; the caller nudges, then repeats. There is NO auto-submit and
          // NO auto-skip here: a silent candidate is coaxed, never moved on.
          const elapsedMs = now - startedAt;
          for (let i = 0; i < noAnswerStages.length; i += 1) {
            if (elapsedMs >= noAnswerStages[i]! * 1000 && !firedStages.has(i)) {
              firedStages.add(i);
              onNoAnswerStageRef.current(i);
            }
          }
          waiting = Math.round(elapsedMs / 1000);
        }
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
  }, [stream, active, silenceSeconds, minSpeechSeconds, noAnswerStages]);

  // Guarded rather than cleared: while nothing is being watched there is no
  // countdown, whatever the last sample happened to leave behind.
  return {
    secondsRemaining: active ? secondsRemaining : null,
    noAnswerIn: active ? noAnswerIn : null,
  };
}
