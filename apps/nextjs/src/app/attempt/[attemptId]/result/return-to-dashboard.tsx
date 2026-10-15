"use client";

import { useEffect } from "react";

/** Redirect to the partner dashboard after this long with no interaction. */
const INACTIVITY_MS = 30_000;

/**
 * The "you're done" call to action: a button straight to the partner dashboard,
 * and — if the candidate just leaves the page sitting — an automatic redirect
 * there after 30s of inactivity. Any interaction (move, tap, key, scroll)
 * resets the timer, so it never yanks them away mid-read.
 */
export function ReturnToDashboard({ url }: { url: string }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const go = () => {
      window.location.href = url;
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(go, INACTIVITY_MS);
    };
    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ] as const;
    for (const e of events)
      window.addEventListener(e, reset, { passive: true });
    reset(); // start the countdown now

    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [url]);

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <a
        href={url}
        className="inline-flex items-center gap-2.5 rounded-xl border border-border-subtle bg-surface px-12 py-2 text-base font-semibold text-content shadow-[var(--shadow-raised)] transition-colors hover:bg-surface-muted"
      >
        <span>Go to</span>
        {/* The wordmark sits in the upper part of the asset (the tagline fills
            the lower part), so nudge it down a hair to line the "Path Saathi"
            text up with "Go to" / "dashboard". */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img
          src="/assets/logo-horizontal.webp"
          alt="Path Saathi"
          className="h-16 w-auto pb-4 shrink-0 translate-y-0.75 select-none"
        />
        <span>dashboard</span>
      </a>
      <p className="text-xs text-content-muted">
        You&apos;ll be taken there automatically in a few seconds.
      </p>
    </div>
  );
}
