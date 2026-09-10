"use client";

import { useEffect, useId, useRef } from "react";

import { cn } from "~/lib/utils";

/**
 * Modal dialog.
 *
 * Built on the native `<dialog>` element rather than a div with a high
 * z-index, because `showModal()` gives us the things a hand-rolled modal
 * usually gets wrong for free: a focus trap, Escape to dismiss, the rest of
 * the page marked inert for assistive tech, and top-layer stacking that no
 * parent's `overflow` or `transform` can clip.
 *
 * `open` is the source of truth. The native close event (Escape, backdrop,
 * the X) calls `onClose` so the parent's state follows rather than drifting.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  /** Rendered in the header. Pass a node to include a status pill. */
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Id of the element naming the dialog. Defaults to the built-in title. */
  labelledBy?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // `showModal` does not stop the page behind from scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click that lands on the dialog itself is a click on the backdrop:
      // everything visible is inside the child below.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={labelledBy ?? titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        // `m-auto` is load-bearing: a modal <dialog> is centred by the
        // browser's own `margin: auto` against its zero insets, and
        // Tailwind's preflight resets every element's margin to 0 — which
        // silently drops it into the top-left corner.
        "m-auto max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] overflow-hidden rounded-2xl p-0",
        "border border-border-subtle bg-surface text-content",
        "shadow-[var(--shadow-raised)]",
        "backdrop:bg-content/40",
      )}
    >
      {/* The inner wrapper is what the backdrop check above tests against,
          and what caps the height so only the body scrolls. Subtract the
          dialog border as well, so it never creates a second scroll area. */}
      <div className="flex max-h-[min(50rem,calc(100dvh-2rem-2px))] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-5 py-5 sm:px-7">
          <div className="min-w-0 flex-1">
            <h2
              id={labelledBy ?? titleId}
              className="flex flex-wrap items-center gap-2.5 text-base font-semibold tracking-tight"
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm text-content-muted">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "-mt-1 -mr-1 grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg",
              "text-content-muted transition-colors hover:bg-surface-muted hover:text-content",
            )}
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
          {children}
        </div>

        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
