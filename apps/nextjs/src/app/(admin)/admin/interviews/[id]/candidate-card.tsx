"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deleteAttemptAction } from "~/server/admin/actions";
import type { AttemptSummary } from "~/server/admin/dto";

/**
 * A candidate as a video card, YouTube-style.
 *
 * The recorded answer plays as the thumbnail (first frame at rest, plays on
 * hover). The score sits on the thumbnail at all times; the name is revealed
 * over a vignette on hover. The clip is only fetched once the card scrolls near
 * the viewport, so a page of 100+ candidates does not pull 100 videos at once.
 */
export function CandidateCard({
  attempt,
  statusLabel,
  interviewId,
  isDev,
  returnTo,
}: {
  attempt: AttemptSummary;
  statusLabel: string;
  interviewId: string;
  /** Shows the cost badge and the delete button. Never true in production. */
  isDev: boolean;
  returnTo: string;
}) {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const [deleting, startDeleting] = useTransition();
  /**
   * Armed by the first click, does the deed on the second.
   *
   * A button that appears on hover and destroys an interview on one click is
   * one stray mouse movement away from losing a test run someone was reading.
   * Cheaper than a modal and enough of a speed bump.
   */
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const src = attempt.thumbnailVideoId
    ? `/api/media/${attempt.thumbnailVideoId}`
    : null;
  const initial = attempt.candidateName.trim().charAt(0).toUpperCase() || "?";
  const score = attempt.overallScore;

  function play() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  }
  function stop() {
    videoRef.current?.pause();
  }

  function confirmDelete(event: React.MouseEvent) {
    // Inside a card that is a link. Neither click should navigate.
    event.preventDefault();
    event.stopPropagation();
    if (!armed) {
      setArmed(true);
      return;
    }
    startDeleting(async () => {
      await deleteAttemptAction(attempt.id, interviewId);
      router.refresh();
    });
  }

  return (
    <div className="group relative" onMouseLeave={() => setArmed(false)}>
      <Link
        ref={cardRef}
        href={`/admin/attempts/${attempt.id}?from=${encodeURIComponent(returnTo)}`}
        onMouseEnter={play}
        onMouseLeave={stop}
        className="block overflow-hidden rounded-xl border border-border-subtle bg-surface transition-colors hover:border-border-strong"
      >
        <div className="relative aspect-video bg-content/90">
          {src && visible ? (
            <video
              ref={videoRef}
              src={src}
              muted
              playsInline
              preload="metadata"
              // Mirrored, like the report player and the live self-view —
              // see the note there.
              className="h-full w-full -scale-x-100 object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-linear-to-br from-surface-muted to-content/10">
              <span className="grid size-14 place-items-center rounded-full bg-surface text-lg font-semibold text-content-muted">
                {initial}
              </span>
            </div>
          )}

          {/* Status, always visible. */}
          <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                attempt.status === "completed"
                  ? "bg-success"
                  : attempt.status === "failed"
                    ? "bg-danger"
                    : attempt.status === "not_started"
                      ? "bg-white/60"
                      : "bg-warning"
              }`}
            />
            {statusLabel}
          </span>

          {/* Score, always overlapped on the thumbnail when it exists. */}
          {score !== null ? (
            <span className="absolute top-2 right-2 rounded-md bg-black/70 px-2 py-1 text-sm font-semibold text-white tabular-nums backdrop-blur-sm">
              {score}
              <span className="text-white/60">/100</span>
            </span>
          ) : null}

          {/* Hover: vignette + who it is. */}
          <div className="pointer-events-none absolute inset-0 flex items-end bg-linear-to-t from-black/85 via-black/25 to-transparent p-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {attempt.candidateName}
              </p>
              {attempt.candidateEmail ? (
                <p className="truncate text-xs text-white/70">
                  {attempt.candidateEmail}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </Link>

      {/*
       * Development only: what this interview cost to run.
       *
       * An unmetered interview shows a dash, not ₹0.00. Most of these ran
       * before the counters existed, and a zero next to a completed interview
       * is a claim that it was free — which is how a readout like this stops
       * being believed.
       */}
      {isDev ? (
        <span
          title={
            attempt.devCost
              ? "Estimated provider cost — rates in config/pricing.ts are unverified"
              : "No usage recorded: this interview ran before cost tracking"
          }
          className={`pointer-events-none absolute bottom-2 left-2 rounded-md px-2 py-1 text-xs font-semibold tabular-nums backdrop-blur-sm ${
            attempt.devCost
              ? "bg-black/70 text-white"
              : "bg-black/45 text-white/50"
          }`}
        >
          {attempt.devCost ?? "₹—"}
        </span>
      ) : null}

      {/* Development only: throw this attempt away. Revealed on hover. */}
      {isDev ? (
        <button
          type="button"
          onClick={confirmDelete}
          disabled={deleting}
          className={`absolute right-2 bottom-2 rounded-md px-2 py-1 text-xs font-semibold text-white opacity-0 backdrop-blur-sm transition focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-60 ${
            armed ? "bg-danger" : "bg-black/70 hover:bg-danger"
          }`}
        >
          {deleting ? "Deleting…" : armed ? "Sure?" : "Delete"}
        </button>
      ) : null}
    </div>
  );
}
