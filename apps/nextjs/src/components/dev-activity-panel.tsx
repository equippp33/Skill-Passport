"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Development-only readout of which service served each leg of the interview.
 *
 * Split by leg on purpose. "The turn was slow" is never actionable; "TTS took
 * 4s" is. And `AI_PROVIDER=sarvam` does not mean Sarvam answered the brain
 * call — the dispatch in `~/server/services/openai` falls back to OpenAI when
 * Sarvam fails and then skips it for minutes, silently — so the provider that
 * actually ran is named per section.
 *
 * Rendered only when NODE_ENV is "development": the check is in the parent AND
 * the server sends an empty list otherwise, so there are two independent
 * reasons this can never appear for a real candidate.
 *
 * Draggable by its header, because where it sits by default is sometimes
 * exactly where the question is.
 */

export type ActivitySection = "brain" | "stt" | "tts" | "other";

export interface ActivityEvent {
  at: number;
  section: ActivitySection;
  provider: string;
  model: string;
  detail: string;
  ms: number;
  ok: boolean;
}

const SECTIONS: { key: ActivitySection; label: string; dot: string }[] = [
  { key: "brain", label: "Brain", dot: "bg-violet-400" },
  { key: "stt", label: "STT", dot: "bg-emerald-400" },
  { key: "tts", label: "TTS", dot: "bg-sky-400" },
  { key: "other", label: "Storage", dot: "bg-neutral-500" },
];

/**
 * Pointer travel, in px, past which a press counts as a drag rather than a
 * click. Without it a slightly sloppy click would move the panel a pixel and
 * swallow the collapse toggle.
 */
const DRAG_THRESHOLD_PX = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** `2573` -> `2.6s`; anything under a second stays in ms. */
function ms(value: number): string {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

/** `524` -> `8:44`. */
function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`;
}

export function DevActivityPanel({
  events,
  startedAt,
  onClose,
}: {
  events: ActivityEvent[];
  /**
   * Attempt start, ISO. Drives the live clock. Null on the admin side, where
   * there is no single attempt — the clock then runs from the first recorded
   * call instead, which is the same window in practice.
   */
  startedAt: string | null;
  /** Dismiss the panel for the rest of this page. */
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  /**
   * Null until dragged, so it starts in the corner via CSS classes and needs
   * no window measurement on first render (which would differ between server
   * and client and trip hydration).
   */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * Null on the first render — server and client agree on "—", and the clock
   * only starts once the interval below has ticked. Rendering a computed
   * elapsed time during hydration would be a mismatch.
   */
  const [elapsed, setElapsed] = useState<number | null>(null);

  const nodeRef = useRef<HTMLDivElement | null>(null);
  const grabRef = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  // On the interview this is the attempt's own start; on admin there is no
  // single attempt, so the first recorded call stands in for it.
  const firstEventAt = events[0]?.at ?? null;
  useEffect(() => {
    const began = startedAt ? new Date(startedAt).getTime() : firstEventAt;
    if (began === null || Number.isNaN(began)) return;
    const tick = () => setElapsed((Date.now() - began) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, firstEventAt]);

  if (events.length === 0) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = nodeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    grabRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    const node = nodeRef.current;
    if (!grab || !node) return;

    if (!grab.moved) {
      const travelled =
        Math.abs(event.clientX - grab.startX) +
        Math.abs(event.clientY - grab.startY);
      if (travelled < DRAG_THRESHOLD_PX) return;
      grab.moved = true;
      setDragging(true);
    }

    // Clamped so it can never be dragged off-screen and stranded there.
    const rect = node.getBoundingClientRect();
    setPos({
      x: clamp(event.clientX - grab.dx, 0, window.innerWidth - rect.width),
      y: clamp(event.clientY - grab.dy, 0, window.innerHeight - rect.height),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    grabRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    // A press that never became a drag is a click: toggle the list.
    if (grab && !grab.moved) setOpen((v) => !v);
  };

  /** Total time actually spent waiting on external services. */
  const processingMs = events.reduce((sum, e) => sum + e.ms, 0);
  const brainProvider =
    [...events].reverse().find((e) => e.section === "brain")?.provider ?? "—";
  const fallbacks = events.filter(
    (e) => e.provider === "OpenAI (fallback)",
  ).length;

  return (
    <div
      ref={nodeRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`fixed z-50 w-[min(24rem,calc(100vw-1.5rem))] font-mono text-[11px] leading-tight ${
        pos ? "" : "bottom-3 left-3"
      }`}
    >
      <div className="overflow-hidden rounded-lg border border-white/15 bg-neutral-900/95 text-neutral-100 shadow-xl backdrop-blur">
        {/* The drag handle. Not a <button>: it owns pointer capture, and the
            toggle is driven from pointerup so a click still collapses it. */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
          className={`flex touch-none items-center gap-2 px-3 py-2 select-none hover:bg-white/5 ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <span className="font-semibold">Brain: {brainProvider}</span>
          {fallbacks > 0 ? (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
              {fallbacks} fallback{fallbacks === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="ml-auto text-neutral-500">{open ? "▾" : "▸"}</span>
          {/* Its own button, and it stops the pointer reaching the drag
              handle — otherwise pressing the cross would start a drag and
              the pointerup that follows would toggle instead of close. */}
          <button
            type="button"
            aria-label="Close debug panel"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="-my-1 -mr-1 cursor-pointer rounded px-1.5 py-1 text-neutral-500 hover:bg-white/10 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        {/* The two numbers asked of this panel most often: how long the
            candidate has been here, and how much of that was us waiting on a
            provider rather than them talking. */}
        <div className="flex gap-4 border-t border-white/10 bg-white/5 px-3 py-1.5">
          <span>
            <span className="text-neutral-500">interview </span>
            <span className="font-semibold tabular-nums">
              {elapsed === null ? "—" : clock(elapsed)}
            </span>
          </span>
          <span>
            <span className="text-neutral-500">processing </span>
            <span className="font-semibold tabular-nums">
              {ms(processingMs)}
            </span>
          </span>
          <span className="ml-auto text-neutral-500">
            {events.length} call{events.length === 1 ? "" : "s"}
          </span>
        </div>

        {open ? (
          <div className="max-h-72 overflow-y-auto border-t border-white/10">
            {SECTIONS.map(({ key, label, dot }) => {
              const rows = events.filter((e) => e.section === key);
              if (rows.length === 0) return null;
              const total = rows.reduce((sum, e) => sum + e.ms, 0);
              // Whichever provider served this leg most recently.
              const provider = rows[rows.length - 1]!.provider;
              const model = rows[rows.length - 1]!.model;

              return (
                <div
                  key={key}
                  className="border-b border-white/5 last:border-b-0"
                >
                  <div className="flex items-baseline gap-2 bg-white/5 px-3 py-1">
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${dot}`}
                    />
                    <span className="font-semibold">{label}</span>
                    <span className="text-neutral-300">{provider}</span>
                    {model ? (
                      <span className="truncate text-neutral-500">{model}</span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-neutral-400 tabular-nums">
                      {rows.length} · {ms(total)}
                    </span>
                  </div>

                  {[...rows].reverse().map((e, i) => (
                    <div
                      key={`${e.at}-${i}`}
                      className="flex items-baseline gap-2 px-3 py-1 pl-6"
                    >
                      <span className="text-neutral-500">{timeOf(e.at)}</span>
                      <span className="truncate text-neutral-300">
                        {e.detail}
                      </span>
                      {!e.ok ? (
                        <span className="text-rose-400">failed</span>
                      ) : null}
                      <span className="ml-auto shrink-0 tabular-nums">
                        {ms(e.ms)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-neutral-500">
          dev only · drag to move · not shown in production
        </div>
      </div>
    </div>
  );
}
