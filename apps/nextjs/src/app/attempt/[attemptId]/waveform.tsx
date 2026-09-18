"use client";

import { useEffect, useRef } from "react";

/**
 * A live bar waveform of the candidate's microphone.
 *
 * Purely reassurance — it shows them they are being heard while they answer,
 * the way a call app does. Reads amplitude straight off the stream with an
 * AnalyserNode and writes bar heights to the DOM directly (no per-frame React
 * state), so it is cheap enough for a low-end phone. Nothing is recorded here.
 */
export function Waveform({
  stream,
  active,
  bars = 28,
}: {
  stream: MediaStream | null;
  active: boolean;
  bars?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || !stream || stream.getAudioTracks().length === 0) return;

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    let context: AudioContext;
    try {
      context = new AudioCtx();
    } catch {
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const el = containerRef.current;
      if (el) {
        const children = el.children;
        for (let i = 0; i < children.length; i += 1) {
          const v = data[i] ?? 0; // 0–255
          const h = 6 + (v / 255) * 42; // px, a small resting height + peak
          (children[i] as HTMLElement).style.height = `${h}px`;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [stream, active]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="flex h-14 items-center justify-center gap-1"
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-accent/70"
          style={{ height: 6 }}
        />
      ))}
    </div>
  );
}
