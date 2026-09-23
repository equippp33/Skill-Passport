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
const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Split into user-perceived characters, so a reveal never cuts a cluster. */
function toGraphemes(text: string): string[] {
  // Reveal by grapheme cluster, not UTF-16 code unit — a cut inside an Indic
  // cluster (base + vowel sign / virama / anusvara) orphans the combining mark
  // and renders it as a stray dotted circle (◌). Segmenter keeps clusters whole;
  // the spread fallback at least iterates by code point, not code unit.
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (s) => s.segment)
    : [...text];
}

export function useTypewriter(text: string, charsPerSecond = 22): string {
  const [shown, setShown] = useState("");

  useEffect(() => {
    const clusters = toGraphemes(text);
    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const n = Math.floor(((now - start) / 1000) * charsPerSecond);
      setShown(clusters.slice(0, Math.min(n, clusters.length)).join(""));
      if (n < clusters.length) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, charsPerSecond]);

  return shown;
}
