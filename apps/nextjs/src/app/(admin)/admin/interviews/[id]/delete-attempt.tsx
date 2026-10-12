"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteAttemptAction } from "~/server/admin/actions";

/**
 * Remove a test run from the grid. DEVELOPMENT ONLY.
 *
 * The card is one big `<Link>`, so every click here has to be stopped before
 * it reaches the anchor — otherwise asking to delete someone navigates to
 * their report instead, and the confirm step never appears.
 *
 * Deliberately two taps. The first only arms it; the second does it. Nothing
 * here is recoverable — the report, the transcripts and the candidate's
 * recordings of themselves all go — and that is far too much to hang off a
 * single click on a control that lives one pixel from the score badge.
 *
 * Both the button and the confirmation panel position themselves against the
 * THUMBNAIL, so this must be rendered as a direct child of it. An earlier
 * version put the button inside the little badge row at the top right, and
 * because that row is itself absolutely positioned, `inset-0` resolved
 * against the row rather than the card — the warning rendered correctly and
 * entirely invisibly, folded into a column a few characters wide.
 */
export function DeleteAttempt({
  attemptId,
  candidateName,
  hasScore,
}: {
  attemptId: string;
  candidateName: string;
  /** Whether a score badge occupies the top-right corner. */
  hasScore: boolean;
}) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Keep the click off the card's link, whatever it was for. */
  function swallow(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function confirm(e: React.MouseEvent) {
    swallow(e);
    setError(null);
    startTransition(async () => {
      const result = await deleteAttemptAction(attemptId);
      if (!result.ok) {
        setError(result.error ?? "Could not delete this attempt.");
        setArming(false);
        return;
      }
      router.refresh();
    });
  }

  if (arming) {
    return (
      <div
        onClick={swallow}
        className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-center backdrop-blur-sm"
      >
        <div>
          <p className="text-sm font-semibold text-white">
            Delete {candidateName}?
          </p>
          <p className="mt-1 text-xs text-white/70">
            The report, transcripts and recordings go permanently. This cannot
            be undone.
          </p>
          {error ? (
            <p className="mt-2 text-xs font-medium text-danger">{error}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              swallow(e);
              setArming(false);
            }}
            className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending}
            className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        swallow(e);
        setArming(true);
      }}
      aria-label={`Delete ${candidateName}`}
      title="Delete this attempt (development only)"
      className={`absolute top-2 z-30 rounded-md bg-black/70 p-1.5 text-white/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-danger hover:text-white group-hover:opacity-100 focus-visible:opacity-100 ${
        // Clear of the score badge when there is one, in its place when not.
        hasScore ? "right-[4.5rem]" : "right-2"
      }`}
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path
          d="M4 6h12M8.5 6V4.5h3V6M6 6l.7 9.5h6.6L14 6M8.5 9v4M11.5 9v4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
