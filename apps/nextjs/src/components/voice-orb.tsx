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
 * Original work: a window into cloud. A blue crown at the top, everything
 * below it lit milk-white, with three oversized masses rolling slowly past
 * each other underneath so the light in it never sits still.
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
          // Autoplay policy can hand back a suspended context; without this the
          // analyser reads pure zeros and the orb never moves for a real voice.
          void context.resume().catch(() => undefined);
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
           * Blue the whole way down, thinning rather than stopping. The
           * cloud above it is what makes the lower half read as white, so
           * this has to stay saturated — an earlier version fell to near-white
           * by a third of the way down, and once the cloud was laid over that
           * there was no blue left anywhere and the orb went blank.
           */
          background:
            "linear-gradient(178deg, #3f63ee 0%, #5478f2 16%, #7b97f6 33%, #a8bbfa 52%, #ccd6fd 72%, #e4e8ff 100%)",
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
         * The cloud the orb is looking through.
         *
         * Three masses, each much larger than the orb, on two independent
         * animations apiece: an outer one that fades the whole mass in and
         * out, an inner one that rolls and swells it. Six periods, none a
         * multiple of another, so the layers are never in the same
         * arrangement twice and the white gathers and thins the way smoke
         * does rather than sliding past like a texture.
         *
         * The fade is the important half. Motion alone reads as a picture
         * being dragged across the sphere; cloud that also comes and goes
         * reads as something moving through it.
         *
         * They are deliberately not opaque. An earlier version was, and it
         * covered the sky completely — the orb went white with a sliver of
         * blue left at the crown. The blue underneath has to keep showing
         * through for any of this to look like depth.
         *
         * Still pure gradients — no `filter: blur()`, so the whole thing
         * stays on the compositor for the length of an interview.
         */}
        <div
          className="orb-layer absolute inset-0"
          style={{
            animation: `orb-fade-a ${speaking ? "19s" : "31s"} ease-in-out infinite`,
          }}
        >
          <div
            className="orb-layer absolute inset-[-45%]"
            style={{
              background: MASS_LOW,
              animation: `orb-roll-a ${speaking ? "26s" : "44s"} ease-in-out infinite`,
            }}
          />
        </div>

        <div
          className="orb-layer absolute inset-0"
          style={{
            animation: `orb-fade-b ${speaking ? "23s" : "38s"} ease-in-out infinite`,
          }}
        >
          <div
            className="orb-layer absolute inset-[-45%]"
            style={{
              background: MASS_MID,
              animation: `orb-roll-b ${speaking ? "34s" : "57s"} ease-in-out infinite`,
            }}
          />
        </div>

        <div
          className="orb-layer absolute inset-0"
          style={{
            animation: `orb-fade-c ${speaking ? "29s" : "49s"} ease-in-out infinite`,
          }}
        >
          <div
            className="orb-layer absolute inset-[-45%]"
            style={{
              background: MASS_EDGE,
              animation: `orb-roll-c ${speaking ? "41s" : "69s"} ease-in-out infinite`,
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
 * A mass of cloud, as a stack of gradients.
 *
 * Each is drawn on a box half again as wide as the orb and then drifts across
 * it, so only part of any mass is ever visible and the shapes that reach the
 * edge are cut by the sphere rather than fading out inside it — which is what
 * stops them reading as blobs floating in a circle.
 *
 * Peak alpha sits around two thirds, never at one. These are lit vapour with
 * sky behind them, and the moment a mass goes opaque the blue stops showing
 * through and the orb turns into a white disc — which is exactly what happened
 * when these were drawn at 0.99.
 */

/** The bulk of it, gathered low. */
const MASS_LOW = [
  "radial-gradient(56% 38% at 30% 74%, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.5) 44%, rgba(255,255,255,0.18) 70%, rgba(255,255,255,0) 88%)",
  "radial-gradient(48% 32% at 72% 82%, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.42) 46%, rgba(255,255,255,0.12) 72%, rgba(255,255,255,0) 90%)",
  "radial-gradient(40% 26% at 50% 60%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.26) 50%, rgba(255,255,255,0) 82%)",
].join(", ");

/** The band across the middle, where cloud and sky trade places. */
const MASS_MID = [
  "radial-gradient(50% 24% at 26% 48%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.34) 46%, rgba(255,255,255,0.1) 72%, rgba(255,255,255,0) 88%)",
  "radial-gradient(42% 19% at 68% 42%, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.28) 48%, rgba(255,255,255,0) 84%)",
  // A cooler hollow, so the white has shape in it rather than reading flat.
  "radial-gradient(34% 18% at 48% 62%, rgba(150,175,235,0.2) 0%, rgba(150,175,235,0) 76%)",
].join(", ");

/** Thin stuff riding up into the blue, keeping the crown from being a band. */
const MASS_EDGE = [
  "radial-gradient(38% 13% at 34% 34%, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 82%)",
  "radial-gradient(28% 9% at 64% 28%, rgba(255,255,255,0.36) 0%, rgba(255,255,255,0.14) 52%, rgba(255,255,255,0) 84%)",
  "radial-gradient(46% 11% at 52% 44%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.17) 50%, rgba(255,255,255,0) 84%)",
].join(", ");

/** Announced to screen readers, which cannot see any of the above. */
const ORB_LABEL: Record<OrbState, string> = {
  idle: "Interviewer waiting",
  listening: "Listening to your answer",
  processing: "Preparing the next question",
  speaking: "Interviewer speaking",
};
