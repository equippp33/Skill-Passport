"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui";
import {
  cancelRescoreAllAction,
  rescoreAllAction,
  rescoreAllProgressAction,
} from "~/server/admin/actions";
import type { RescoreProgress } from "~/server/attempt/rescore-job";

/**
 * Re-grade every completed attempt under this interview. DEVELOPMENT ONLY.
 *
 * The confirmation is not a formality. This runs for a long time on links of
 * any size and every candidate's scores change — so the warning states the
 * count and the estimate rather than asking "are you sure?".
 *
 * Progress is polled rather than streamed: the work outlives the request that
 * started it, so there is nothing to hold open. Polling also means the bar
 * picks itself back up after a page refresh, which matters for something that
 * runs this long.
 */
export function RescoreAll({
  interviewId,
  completedCount,
  rescoredCount,
}: {
  interviewId: string;
  completedCount: number;
  /** How many already carry a snapshot, so the rest can be picked up. */
  rescoredCount: number;
}) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [progress, setProgress] = useState<RescoreProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether to keep asking the server where the job is.
   *
   * Starts true so a job already running is picked up when the page loads or
   * is refreshed — this outlives the request that began it, so the page has
   * no other way to know. Switches off as soon as a poll comes back with
   * nothing running, which is also how it stops when there is no job at all.
   */
  const [polling, setPolling] = useState(true);

  /** Never re-scored, so a stopped run can be picked up rather than redone. */
  const remaining = Math.max(0, completedCount - rescoredCount);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    const tick = async () => {
      const p = await rescoreAllProgressAction(interviewId);
      if (cancelled) return;
      setProgress(p);
      if (!p?.running) {
        setPolling(false);
        // Finished rather than absent: bring the new scores onto the page.
        if (p) router.refresh();
      }
    };

    const timer = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling, interviewId, router]);

  async function start(mode: "remaining" | "all" | "retry") {
    setError(null);
    const result = await rescoreAllAction(interviewId, mode);
    if (!result.ok) {
      setError(result.error ?? "Could not start the re-score.");
      return;
    }
    setArming(false);
    setProgress(result.progress ?? null);
    setPolling(true);
  }

  async function stop() {
    const result = await cancelRescoreAllAction(interviewId);
    if (result.progress) setProgress(result.progress);
  }

  if (progress?.running) {
    const pct = progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
    return (
      <div className="min-w-64 rounded-lg border border-border-subtle bg-surface px-3 py-2">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-medium">
            {progress.cancelled ? "Stopping" : "Re-scoring"} {progress.done}
            {progress.total ? ` of ${progress.total}` : ""}
          </span>
          <span className="text-content-muted tabular-nums">
            {progress.cancelled
              ? "finishing current"
              : progress.etaSeconds !== null
                ? `~${formatEta(progress.etaSeconds)} left`
                : "estimating…"}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-xs text-danger">
            {progress.failed > 0 ? `${progress.failed} failed` : ""}
          </span>
          {!progress.cancelled ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="text-xs font-medium text-content-muted underline-offset-4 hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (arming) {
    return (
      <div className="max-w-sm rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5">
        <p className="text-sm font-semibold">
          Re-score all {completedCount} completed candidates?
        </p>
        <p className="mt-1 text-xs text-content-muted">
          Every candidate is graded again from their stored answers. Scores can
          only go up, never down. You can stop it part way — whatever has
          finished keeps its new scores, and starting again picks up from
          there.
        </p>
        {rescoredCount > 0 ? (
          <p className="mt-1.5 text-xs">
            <b className="font-semibold">{rescoredCount}</b> already re-scored
            {remaining > 0 ? (
              <>
                {", "}
                <b className="font-semibold">{remaining}</b> left — about{" "}
                {formatEta(estimateSeconds(remaining))}.
              </>
            ) : (
              " — nothing left to do."
            )}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-content-muted">
            About {formatEta(estimateSeconds(completedCount))}.
          </p>
        )}
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setArming(false)}
          >
            Cancel
          </Button>
          {/* The usual choice: pick up where the last run stopped. */}
          {remaining > 0 && remaining < completedCount ? (
            <Button size="sm" onClick={() => void start("remaining")}>
              Continue {remaining}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={remaining < completedCount ? "secondary" : undefined}
            onClick={() => void start("all")}
          >
            {remaining < completedCount
              ? `Do all ${completedCount} again`
              : `Re-score all ${completedCount}`}
          </Button>
        </div>
      </div>
    );
  }

  const finished = progress && !progress.running;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {/* Only what the last run could not finish — usually a network blip
            against the database rather than anything wrong with the answers. */}
        {finished && progress.retryable > 0 ? (
          <Button size="sm" onClick={() => void start("retry")}>
            Retry {progress.retryable} failed
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setArming(true)}
          disabled={completedCount === 0}
          title="Re-grade completed attempts (development only)"
        >
          {remaining > 0 && remaining < completedCount
            ? `Re-score (${remaining} left)`
            : "Re-score all"}
        </Button>
      </div>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      {finished && progress.total > 0 ? (
        <span className="text-xs text-content-muted">
          {progress.cancelled ? "Stopped" : "Done"} —{" "}
          {progress.done - progress.failed} re-scored
          {progress.failed > 0 ? `, ${progress.failed} failed` : ""}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Four attempts at a time, ~10 seconds each.
 *
 * From the measured 1.1s per scored answer: thirteen answers four-up is under
 * four seconds, plus the summary and the translations. Only the opening
 * estimate — once one attempt has finished, the bar switches to the rate
 * actually being achieved.
 */
function estimateSeconds(count: number): number {
  return Math.round((count * 10) / 4);
}

function formatEta(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} hours`;
}
