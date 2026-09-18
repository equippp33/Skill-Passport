"use client";

import { cn } from "~/lib/utils";

/**
 * The interviewer, as a living orb.
 *
 * It breathes gently at rest and pulses harder while the interviewer is
 * speaking, so the candidate has something alive to look at — the Zoom-call
 * feeling of talking to someone, not filling a form. Purely decorative: no
 * state of its own, driven entirely by the `speaking` flag.
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
      {/* Outer halo — expands and fades outward only while speaking. */}
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-accent/25 blur-2xl transition-all duration-700",
          speaking ? "size-[26rem] opacity-100" : "size-72 opacity-60",
        )}
      />
      {/* Mid glow. */}
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-accent/30 blur-xl transition-all duration-500",
          speaking ? "size-72" : "size-56",
        )}
      />
      {/* The orb itself — a soft gradient sphere that breathes. */}
      <span
        aria-hidden
        className={cn(
          "relative rounded-full bg-linear-to-br from-accent via-accent to-accent/50 shadow-[0_20px_80px_-10px_var(--color-accent)]",
          "size-44 sm:size-52",
        )}
        style={{
          animation: speaking
            ? "ai-blob-talk 1.1s ease-in-out infinite"
            : "ai-blob-idle 4.5s ease-in-out infinite",
        }}
      >
        {/* Inner highlight, for depth. */}
        <span className="absolute inset-3 rounded-full bg-linear-to-br from-white/30 to-transparent" />
      </span>
    </div>
  );
}
