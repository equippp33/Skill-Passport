"use client";

import { useRef, useState } from "react";

/**
 * Development-only readout of which model answered each turn.
 *
 * `AI_PROVIDER=sarvam` does not guarantee Sarvam served the turn — the
 * dispatch in `~/server/services/openai` falls back to OpenAI when Sarvam
 * fails, and then skips Sarvam for a few minutes. In front of a candidate that
 * silence is correct; while developing it hides exactly what you want to
 * check, so this panel says it out loud.
 *
 * Rendered only when NODE_ENV is "development" — the check is in the parent AND
 * the server sends an empty list otherwise, so there are two independent
 * reasons this can never appear for a real candidate.
 *
 * Draggable by its header, because where it sits by default is sometimes
 * exactly where the question text is.
 */

export interface DevLlmCall {
  at: number;
  provider: "sarvam" | "openai" | "openai-fallback";
  kind: string;
  schemaName: string;
  ms: number;
  ok: boolean;
  note?: string;
}

/** Colour by what it means, not by provider name: amber = not what you asked for. */
const STYLES: Record<DevLlmCall["provider"], { dot: string; label: string }> = {
  sarvam: { dot: "bg-emerald-500", label: "Sarvam" },
  openai: { dot: "bg-sky-500", label: "OpenAI" },
  "openai-fallback": { dot: "bg-amber-500", label: "OpenAI (fallback)" },
};

/**
 * Pointer travel, in px, past which a press counts as a drag rather than a
 * click. Without it a slightly sloppy click on the header would move the panel
 * a pixel and swallow the collapse toggle.
 */
const DRAG_THRESHOLD_PX = 4;

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function DevLlmPanel({ calls }: { calls: DevLlmCall[] }) {
  const [open, setOpen] = useState(true);
  /**
   * Null until it is dragged, so it starts in the corner via CSS classes and
   * needs no window measurement on first render (which would differ between
   * server and client and trip hydration).
   *
   * Held in state, not localStorage: the panel stays put for the whole session
   * because it never unmounts, and a refresh putting it back in the corner is
   * the right default for a debugging aid.
   */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const nodeRef = useRef<HTMLDivElement | null>(null);
  /** Grab offset within the panel, plus whether this press has become a drag. */
  const grabRef = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  if (calls.length === 0) return null;

  // Newest first: the turn just served is the one being asked about.
  const ordered = [...calls].reverse();
  const latest = ordered[0]!;
  const fallbacks = calls.filter(
    (c) => c.provider === "openai-fallback",
  ).length;

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

  return (
    <div
      ref={nodeRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`fixed z-50 max-w-[min(26rem,calc(100vw-1.5rem))] font-mono text-[11px] leading-tight ${
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
          className={`flex touch-none items-center gap-2 px-3 py-2 text-left select-none hover:bg-white/5 ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${STYLES[latest.provider].dot}`}
          />
          <span className="font-semibold">{STYLES[latest.provider].label}</span>
          <span className="text-neutral-400">
            {latest.ms}ms · {latest.kind}
          </span>
          {fallbacks > 0 ? (
            <span className="ml-auto rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
              {fallbacks} fallback{fallbacks === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="ml-auto text-neutral-500">{open ? "▾" : "▸"}</span>
        </div>

        {open ? (
          <div className="max-h-64 overflow-y-auto border-t border-white/10">
            {ordered.map((call, i) => (
              <div
                key={`${call.at}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-white/5 px-3 py-1.5 last:border-b-0"
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${STYLES[call.provider].dot}`}
                />
                <span className="text-neutral-500">{timeOf(call.at)}</span>
                <span className="font-semibold">
                  {STYLES[call.provider].label}
                </span>
                <span className="text-neutral-400">{call.schemaName}</span>
                <span className="text-neutral-400">{call.ms}ms</span>
                {!call.ok ? (
                  <span className="text-rose-400">failed</span>
                ) : null}
                {call.note ? (
                  <span className="w-full break-words text-amber-300/80">
                    {call.note}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-neutral-500">
          dev only · drag to move · not shown in production
        </div>
      </div>
    </div>
  );
}
