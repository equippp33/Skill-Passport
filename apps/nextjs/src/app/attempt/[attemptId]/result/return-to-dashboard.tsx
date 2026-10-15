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
        className="inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent/90"
      >
        Go to dashboard
      </a>
      <p className="text-xs text-content-muted">
        You&apos;ll be taken there automatically in a few seconds.
      </p>
    </div>
  );
}
