"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Drive the browser Fullscreen API for one element.
 *
 * Honest limitation: a browser will NOT let a site trap someone in fullscreen —
 * Esc always exits, by security design, and nothing can block it. So this only
 * offers to ENTER fullscreen and reports when the user has LEFT, which the
 * caller uses to show a "return to fullscreen to continue" gate. It is a nudge,
 * not a lock.
 *
 * `request()` must be called from a user gesture (a click), or the browser
 * rejects it — the "continue" button in the gate is exactly that gesture.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>): {
  isFullscreen: boolean;
  request: () => void;
} {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const request = useCallback(() => {
    const el = ref.current;
    if (!el || document.fullscreenElement) return;
    void el.requestFullscreen?.().catch(() => undefined);
  }, [ref]);

  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(Boolean(document.fullscreenElement));
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return { isFullscreen, request };
}
