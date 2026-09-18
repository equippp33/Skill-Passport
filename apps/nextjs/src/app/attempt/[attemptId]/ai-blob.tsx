"use client";

import { cn } from "~/lib/utils";

/**
 * The interviewer, as a living orb.
 *
 * A glass-like sphere: a slowly rotating conic sheen so it looks alive even at
 * rest, radial highlights for depth, and a soft glow that swells while the
 * interviewer is speaking. Breathes gently at rest, pulses harder when talking.
 * Purely decorative — driven entirely by the `speaking` flag, no state.
 */
export function AiBlob({
  speaking,
  className,
}: {
  speaking: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative grid place-items-center", className)}>
      {/* Outer glow — swells while speaking. */}
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full blur-3xl transition-all duration-700",
          speaking ? "size-[30rem] bg-accent/30" : "size-80 bg-accent/20",
        )}
      />

      {/* The sphere. */}
      <span
        aria-hidden
        className="relative size-44 overflow-hidden rounded-full shadow-[0_18px_70px_-10px_var(--color-accent)] sm:size-52"
        style={{
          animation: speaking
            ? "ai-blob-talk 1.1s ease-in-out infinite"
            : "ai-blob-idle 5s ease-in-out infinite",
        }}
      >
        {/* Rotating conic sheen — the "life". Oversized so no hard edges show. */}
        <span
          className="absolute inset-[-30%] rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, var(--color-accent), color-mix(in oklab, var(--color-accent), white 45%), var(--color-accent), color-mix(in oklab, var(--color-accent), black 35%), var(--color-accent))",
            animation: speaking
              ? "ai-blob-rotate 4s linear infinite"
              : "ai-blob-rotate 12s linear infinite",
          }}
        />
        {/* Top-left highlight and bottom-right shade make it read as a sphere. */}
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 34% 28%, rgba(255,255,255,0.6), rgba(255,255,255,0) 55%)",
          }}
        />
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 68% 78%, rgba(0,0,0,0.35), rgba(0,0,0,0) 55%)",
          }}
        />
      </span>
    </div>
  );
}
