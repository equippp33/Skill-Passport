"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";

/** Older Safari (iPad before 16.4) only has the prefixed API. */
type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * Whether this browser can put a page element into fullscreen at all.
 *
 * False on iPhone. Read through `useSyncExternalStore` so the server render
 * (which has no `document`) assumes yes and the browser corrects it without a
 * hydration mismatch.
 */
function canFullscreen(): boolean {
  const proto = HTMLElement.prototype as WebkitElement;
  const hasMethod =
    typeof proto.requestFullscreen === "function" ||
    typeof proto.webkitRequestFullscreen === "function";
  const enabled =
    document.fullscreenEnabled ??
    (document as WebkitDocument).webkitFullscreenEnabled ??
    true;
  return hasMethod && enabled !== false;
}
const noSubscribe = () => () => undefined;

function currentFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ??
    (document as WebkitDocument).webkitFullscreenElement ??
    null
  );
}

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
 *
 * Some browsers cannot go fullscreen at all: iPhone Safari (and every iPhone
 * browser, all built on it) has no fullscreen for web pages, only for video.
 * There `requestFullscreen` does not exist, the tap did nothing, and the
 * candidate sat on "Continue in fullscreen" for ever — the interview waits on
 * this before it plays a word. So when fullscreen is unavailable or refused,
 * the tap counts as having continued: the gate opens and the interview runs
 * in the normal page. The tap still matters — it is what lets the phone play
 * the interviewer's audio.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>): {
  isFullscreen: boolean;
  request: () => void;
  /** False where fullscreen is impossible (iPhone), so the UI can say so. */
  supported: boolean;
} {
  const supported = useSyncExternalStore(noSubscribe, canFullscreen, () => true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Continue was pressed on a browser that could not go fullscreen. */
  const [unavailable, setUnavailable] = useState(false);

  const request = useCallback(() => {
    const el = ref.current as WebkitElement | null;
    if (!el || currentFullscreenElement()) return;

    const enter =
      el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    if (!enter) {
      setUnavailable(true);
      return;
    }
    try {
      const result = enter();
      if (result && typeof result.then === "function") {
        void result.catch(() => setUnavailable(true));
      }
    } catch {
      setUnavailable(true);
    }
  }, [ref]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(currentFullscreenElement()));
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  return { isFullscreen: isFullscreen || unavailable, request, supported };
}
