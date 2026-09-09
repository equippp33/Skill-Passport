"use client";

import { useEffect } from "react";
import type { SyntheticEvent } from "react";

/**
 * Discouraging copying of interview questions.
 *
 * IMPORTANT — what this can and cannot do.
 *
 * A web page CANNOT block screenshots or screen recording. There is no
 * browser API for it: the OS owns the screen, and Print Screen, the Snipping
 * Tool, OBS and a phone camera are all completely outside our reach. Anything
 * claiming otherwise on the web is theatre.
 *
 * What is genuinely achievable, and what this does:
 *  - stop selection, copy, cut, right-click and drag on the question text, so
 *    it cannot be pasted into a translator or a chat window in one gesture;
 *  - block the usual devtools/save/print shortcuts, which raises the effort;
 *  - report when the candidate leaves the tab, which is a real proctoring
 *    signal rather than a prevention.
 *
 * Treat all of it as deterrence. Genuine exam integrity needs either a
 * lockdown browser or human/recorded proctoring — and we already record the
 * webcam, which is the stronger deterrent.
 */

/** Swallow an event that would copy content out of the page. */
export function preventCapture(event: SyntheticEvent): void {
  event.preventDefault();
}

const BLOCKED_KEYS = new Set(["s", "p", "u", "c", "x"]);

export function useCaptureDeterrent(options: {
  /** Called when the tab is hidden or loses focus. */
  onLeave?: () => void;
  enabled: boolean;
}): void {
  const { onLeave, enabled } = options;

  useEffect(() => {
    if (!enabled) return;

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const onKeyDown = (event: KeyboardEvent) => {
      // Devtools. Not a real barrier, just friction.
      if (event.key === "F12") {
        event.preventDefault();
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      // Ctrl/Cmd+Shift+I / J / C — devtools and element picker.
      if (event.shiftKey && ["I", "J", "C"].includes(event.key.toUpperCase())) {
        event.preventDefault();
        return;
      }
      // Save, print, view-source, copy, cut.
      if (BLOCKED_KEYS.has(event.key.toLowerCase())) {
        event.preventDefault();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") onLeave?.();
    };

    // Named, so it can actually be removed — an inline arrow here would leak
    // a listener on every re-run of this effect.
    const onBlur = () => onLeave?.();

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, onLeave]);
}
