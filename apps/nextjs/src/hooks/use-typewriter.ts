"use client";

import { useEffect, useState } from "react";

/**
 * Reveal `text` a few characters at a time, so a question appears to be typed
 * out as the interviewer speaks it rather than snapping in all at once.
 *
 * Time-based (not one-timer-per-character) so the pace is steady regardless of
 * length, and driven from an animation frame so there is no synchronous state
 * write in the effect body. Restarts cleanly whenever the text changes.
 *
 * `charsPerSecond` is tuned to sit near a spoken reading pace.
 */
export function useTypewriter(text: string, charsPerSecond = 22): string {
  const [shown, setShown] = useState("");

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const chars = Math.floor(((now - start) / 1000) * charsPerSecond);
      setShown(text.slice(0, Math.min(chars, text.length)));
      if (chars < text.length) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, charsPerSecond]);

  return shown;
}
