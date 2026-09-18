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
 * Original work: a window onto sky. A blue crown falling away into pale haze,
 * with veils of vapour drifting across it one way at three different speeds —
 * soft enough to read as mist rather than as clouds with edges.
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
          /**
           * A blue crown falling away fast into pale haze.
           *
           * The stops bunch between 13% and 38% on purpose. An even gradient
           * reads as a shaded ball; a quick fall reads as looking up through
           * cloud into clear sky above it. The veils below break that boundary
           * up so it never looks like a painted line.
           */
          background:
            "linear-gradient(178deg, #4f6ff0 0%, #6b88f5 13%, #9cb0f8 25%, #c9d3fc 38%, #dee2fd 56%, #e9eaff 100%)",
          transform: "scale(var(--orb-scale))",
          transition: "transform 90ms linear",
          animation: "orb-breathe 7s ease-in-out infinite",
          // Outer glow, and the faintest weight at the crown. The heavy
          // inner shadows this replaced turned it into a lit sphere; the thing
          // it should look like is a window, which has no shading of its own.
          boxShadow:
            "0 0 60px color-mix(in oklab, var(--accent) 30%, transparent), inset 0 10px 22px rgba(45,85,200,0.16)",
        }}
      >
        {/*
         * Vapour, in three veils.
         *
         * Not clouds with edges — mist. Each veil is a strip twice the orb's
         * width carrying a tile one orb wide, repeated, so drifting it
         * exactly -50% returns the pattern to where it began and the loop
         * cannot be seen. The drift is linear and one-way; the slow rise and
         * fall sits on a wrapper so the two transforms compose rather than
         * overwrite each other.
         *
         * The shapes are deliberately wide and shallow — ellipses several
         * times broader than they are tall, at low alpha, fading from the
         * middle out. Anything rounder or more opaque starts to read as a
         * cartoon cloud, which is what this replaced.
         *
         * The top veil is the one that matters: it lies across the line where
         * the blue gives way, and its drift keeps that boundary feathered and
         * moving instead of a painted horizon.
         *
         * Still pure gradients — no `filter: blur()`, so the whole thing
         * stays on the compositor for the length of an interview.
         */}
        <div
          className="orb-bob absolute inset-x-0 top-[14%] h-[30%]"
          style={{ animation: "orb-bob-b 23s ease-in-out infinite" }}
        >
          <div
            className="orb-layer absolute inset-y-0 left-0 w-[200%]"
            style={{
              backgroundImage: VEIL_CROWN,
              backgroundSize: "50% 100%",
              backgroundRepeat: "repeat-x",
              animation: `orb-drift ${speaking ? "34s" : "58s"} linear infinite`,
            }}
          />
        </div>

        <div
          className="orb-bob absolute inset-x-0 top-[32%] h-[36%]"
          style={{ animation: "orb-bob-a 19s ease-in-out infinite" }}
        >
          <div
            className="orb-layer absolute inset-y-0 left-0 w-[200%]"
            style={{
              backgroundImage: VEIL_MID,
              backgroundSize: "50% 100%",
              backgroundRepeat: "repeat-x",
              animation: `orb-drift ${speaking ? "26s" : "44s"} linear infinite`,
            }}
          />
        </div>

        <div
          className="orb-bob absolute inset-x-0 top-[54%] h-[44%]"
          style={{ animation: "orb-bob-a 29s ease-in-out infinite" }}
        >
          <div
            className="orb-layer absolute inset-y-0 left-0 w-[200%]"
            style={{
              backgroundImage: VEIL_BASE,
              backgroundSize: "50% 100%",
              backgroundRepeat: "repeat-x",
              animation: `orb-drift ${speaking ? "19s" : "32s"} linear infinite`,
            }}
          />
        </div>

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

/**
 * One tile of vapour, as a stack of gradients.
 *
 * Read each line as a wisp: `radial-gradient(<width> <height> at <x> <y>, ...)`.
 * They are wide and shallow — 40-70% across against 7-14% tall — and start
 * well under full opacity, so they haze the sky rather than sit on top of it.
 *
 * Nothing sits within about a tenth of either edge, so no wisp is cut in half
 * at the seam where the tile repeats.
 */

/** Across the blue boundary: the brightest, and the one that shapes it. */
const VEIL_CROWN = [
  "radial-gradient(52% 13% at 22% 62%, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.3) 42%, rgba(255,255,255,0) 76%)",
  "radial-gradient(38% 8% at 44% 44%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.16) 46%, rgba(255,255,255,0) 80%)",
  "radial-gradient(60% 11% at 72% 70%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.24) 44%, rgba(255,255,255,0) 78%)",
  // A little shade, so the haze has depth instead of reading as flat fog.
  "radial-gradient(44% 7% at 56% 30%, rgba(120,150,220,0.18) 0%, rgba(120,150,220,0) 72%)",
].join(", ");

/** The body of the haze. Softest of the three. */
const VEIL_MID = [
  "radial-gradient(64% 12% at 30% 40%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.2) 45%, rgba(255,255,255,0) 80%)",
  "radial-gradient(46% 9% at 66% 60%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.17) 46%, rgba(255,255,255,0) 80%)",
  "radial-gradient(34% 14% at 48% 74%, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.13) 48%, rgba(255,255,255,0) 82%)",
].join(", ");

/** Nearly lost in the pale bottom — just enough to keep it from going flat. */
const VEIL_BASE = [
  "radial-gradient(70% 14% at 36% 44%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.15) 48%, rgba(255,255,255,0) 82%)",
  "radial-gradient(50% 10% at 74% 66%, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.11) 50%, rgba(255,255,255,0) 84%)",
].join(", ");

/** Announced to screen readers, which cannot see any of the above. */
const ORB_LABEL: Record<OrbState, string> = {
  idle: "Interviewer waiting",
  listening: "Listening to your answer",
  processing: "Preparing the next question",
  speaking: "Interviewer speaking",
};
