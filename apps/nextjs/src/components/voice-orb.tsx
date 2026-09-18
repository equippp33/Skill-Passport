"use client";

import { useEffect, useRef } from "react";

/**
 * The interviewer, as a thing on screen.
 *
 * A voice interview has nothing to look at. Without a focal point the
 * candidate watches their own face in the camera, or the question text, and
 * the interview reads as a form being filled in rather than a conversation.
 * The orb gives them somewhere to look and — more usefully — tells them what
 * is happening without a word of UI copy: it is calm when nothing is
 * expected of them, moves with the voice when the interviewer speaks, moves
 * with THEIR voice while they answer, and turns over slowly while it thinks.
 *
 * Original work. Layered radial gradients that drift over one another, drawn
 * from the app's own accent through to violet.
 *
 * Performance, which matters because this is on screen for the whole
 * interview: no `filter: blur()` anywhere (it repaints the blurred region
 * every frame), every animation touches only `transform` or `opacity`, and
 * amplitude is written to a CSS variable by an animation frame instead of
 * through React state, so a speaking orb causes no re-renders at all.
 */

export type OrbState = "idle" | "listening" | "processing" | "speaking";

/**
 * How quickly the orb follows the voice.
 *
 * Attack is fast so a syllable registers; release is slow so the orb settles
 * rather than flickering between words. Following the raw level in both
 * directions looks like a fault, not a voice.
 */
const ATTACK = 0.35;
const RELEASE = 0.08;

/** Level below which the microphone is just room noise. */
const NOISE_FLOOR = 0.012;

/** Amplitude is capped rather than normalised, so a shout cannot fill the screen. */
const MAX_SCALE = 1.25;

export function VoiceOrb({
  state,
  stream,
  className = "",
}: {
  state: OrbState;
  /**
   * The candidate's microphone, used only while `state` is "listening".
   *
   * Analysed with `createMediaStreamSource`, which taps the stream without
   * altering it. The question audio is deliberately NOT analysed: routing a
   * media element through Web Audio is irreversible, and doing it has twice
   * silenced this interview. While the interviewer speaks the orb animates on
   * its own instead.
   */
  stream?: MediaStream | null;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let raf = 0;
    let smoothed = 0;
    let analyser: AnalyserNode | null = null;
    let context: AudioContext | null = null;
    // Typed with its buffer so `getByteTimeDomainData` accepts it: the
    // DOM signature wants a view over a plain ArrayBuffer, and a bare
    // `Uint8Array` annotation widens to ArrayBufferLike.
    let samples: Uint8Array<ArrayBuffer> | null = null;

    const listening = state === "listening";
    if (listening && stream && stream.getAudioTracks().length > 0) {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        try {
          context = new AudioCtx();
          const source = context.createMediaStreamSource(stream);
          analyser = context.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.6;
          source.connect(analyser);
          // Never connected to the destination: that would feed the
          // microphone back out of the speakers and into the recording.
          samples = new Uint8Array(analyser.fftSize);
        } catch {
          // The orb is an enhancement; it animates on its own without this.
          analyser = null;
        }
      }
    }

    const frame = () => {
      raf = requestAnimationFrame(frame);

      let target = 0;
      if (analyser && samples) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) {
          const centred = (s - 128) / 128;
          sum += centred * centred;
        }
        const rms = Math.sqrt(sum / samples.length);
        // Rescaled off the noise floor so a quiet room sits at rest.
        target = Math.min(1, Math.max(0, (rms - NOISE_FLOOR) * 9));
      } else if (state === "speaking") {
        // The interviewer's voice is not measured (see `stream` above), so
        // this stands in for it: three primes beating against each other
        // never quite repeat, which reads as speech rather than a metronome.
        const t = performance.now() / 1000;
        const wave =
          Math.sin(t * 5.3) * 0.5 +
          Math.sin(t * 8.9) * 0.3 +
          Math.sin(t * 13.7) * 0.2;
        target = Math.min(1, Math.abs(wave) * 0.85);
      }

      smoothed += (target - smoothed) * (target > smoothed ? ATTACK : RELEASE);
      root.style.setProperty("--orb-amp", smoothed.toFixed(3));
      root.style.setProperty(
        "--orb-scale",
        (1 + smoothed * (MAX_SCALE - 1)).toFixed(3),
      );
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      analyser?.disconnect();
      void context?.close().catch(() => undefined);
      root.style.setProperty("--orb-amp", "0");
      root.style.setProperty("--orb-scale", "1");
    };
  }, [state, stream]);

  const speaking = state === "speaking";

  return (
    <div
      ref={rootRef}
      data-state={state}
      role="img"
      aria-label={ORB_LABEL[state]}
      style={{ "--orb-amp": 0, "--orb-scale": 1 } as React.CSSProperties}
      className={`relative grid aspect-square place-items-center ${className}`}
    >
      {/* Ambient wash. Sits behind everything and widens with the voice, which
          is what makes the orb feel like it is lighting the room. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent) 38%, transparent) 0%, transparent 68%)",
          transform: "scale(calc(1 + var(--orb-amp) * 0.5))",
          opacity: `calc(0.35 + var(--orb-amp) * 0.5)`,
        }}
      />

      {/* A ring leaving the orb on each phrase — only while it speaks. */}
      {speaking ? (
        <div
          aria-hidden
          className="orb-ripple absolute inset-[12%] rounded-full"
          style={{
            border:
              "1px solid color-mix(in oklab, var(--accent) 55%, transparent)",
            animation: "orb-ripple 2.4s ease-out infinite",
          }}
        />
      ) : null}

      {/* The body: a patch of sky seen through a porthole.
          Overflow-hidden clips the cloud layers to a sphere; the breath is on
          this element and the drift on its children, so the two compose
          instead of fighting. */}
      <div
        aria-hidden
        className="orb-breathe relative aspect-square w-[76%] overflow-hidden rounded-full"
        style={{
          // Deeper blue at the top falling to near-white at the horizon, the
          // way sky actually reads. A radial fill would look like a ball;
          // this looks like distance.
          background:
            "linear-gradient(175deg, #3f6fe8 0%, #6f9bf5 34%, #b9cffb 66%, #eaf1ff 100%)",
          transform: "scale(var(--orb-scale))",
          transition: "transform 90ms linear",
          animation: "orb-breathe 7s ease-in-out infinite",
          boxShadow:
            "0 0 60px color-mix(in oklab, var(--accent) 35%, transparent), inset 0 -18px 30px rgba(255,255,255,0.35), inset 0 14px 26px rgba(40,80,190,0.28)",
        }}
      >
        {/* Cloud. Three banks at different sizes, speeds and directions, each
            a soft white ellipse with a long falloff — a gradient, never a
            blur filter, so the whole thing stays on the compositor. Their
            periods (29/37/43s) share no common factor worth noticing, so the
            sky never visibly repeats. */}
        <div
          className="orb-layer absolute inset-[-30%]"
          style={{
            background:
              "radial-gradient(60% 34% at 38% 62%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 38%, transparent 68%)",
            animation: `orb-cloud-a ${speaking ? "17s" : "29s"} ease-in-out infinite`,
          }}
        />
        <div
          className="orb-layer absolute inset-[-30%]"
          style={{
            background:
              "radial-gradient(52% 26% at 64% 44%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.4) 42%, transparent 70%)",
            animation: `orb-cloud-b ${speaking ? "21s" : "37s"} ease-in-out infinite`,
          }}
        />
        <div
          className="orb-layer absolute inset-[-30%]"
          style={{
            background:
              "radial-gradient(70% 30% at 45% 78%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.6) 34%, transparent 64%)",
            animation: `orb-cloud-c ${speaking ? "25s" : "43s"} ease-in-out infinite`,
          }}
        />

        {/* The curve of the glass. Keeps it reading as a sphere now that the
            inside is flat sky rather than a lit ball. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 32% 24%, rgba(255,255,255,0.45) 0%, transparent 34%), radial-gradient(circle at 50% 50%, transparent 58%, rgba(30,60,150,0.18) 100%)",
          }}
        />
      </div>
    </div>
  );
}

/** Announced to screen readers, which cannot see any of the above. */
const ORB_LABEL: Record<OrbState, string> = {
  idle: "Interviewer waiting",
  listening: "Listening to your answer",
  processing: "Preparing the next question",
  speaking: "Interviewer speaking",
};
