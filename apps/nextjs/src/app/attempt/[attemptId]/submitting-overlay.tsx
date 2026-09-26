"use client";

/**
 * The moment between the last answer and the results page.
 *
 * Everything the candidate has been looking at for ten minutes — the orb, the
 * question, their own face — stops being relevant the instant they finish, but
 * the recordings still have to upload, and on a slow link that takes seconds.
 * Left alone the interview screen just sits there, which reads as a hang at
 * exactly the point somebody most wants to know it worked.
 *
 * So the interview is blurred back rather than replaced: it stays visible
 * underneath, softened, while a single line of text takes the foreground.
 *
 * The bar is real. `flushRecordings` sends the queued recordings one at a time
 * over a list whose length it knows before it starts, so this is progress that
 * has actually happened — not a bar animated against a guess, which is the
 * thing that makes progress bars untrustworthy. When there is nothing left to
 * upload, which is the common case because recordings go up during the
 * interview, it shows an indeterminate sweep for the moment before the results
 * page arrives rather than a misleading full bar.
 *
 * No cancel button: there is nothing useful to cancel. The assessment is
 * already scored server-side, and the recordings are best-effort.
 */
export function SubmittingOverlay({
  title,
  hint,
  done,
  total,
}: {
  /** "Submitting your interview" — in the candidate's own language. */
  title: string;
  /** The quieter second line: the count while uploading, reassurance if not. */
  hint: string;
  /** Recordings sent so far, and how many there were. */
  done: number;
  total: number;
}) {
  const determinate = total > 0;
  const pct = determinate ? Math.round((done / total) * 100) : 0;

  return (
    <div
      role="status"
      aria-live="assertive"
      /**
       * `fixed` and above everything: the interview is finished, so nothing
       * underneath should still invite a click.
       *
       * The backdrop is only lightly tinted. A heavy scrim plus a blur reads
       * as a modal error; a light one reads as the page stepping back.
       */
      className="submitting-overlay fixed inset-0 z-50 flex items-center justify-center bg-surface/55 px-6 backdrop-blur-xl"
    >
      <div className="submitting-panel w-full max-w-xs text-center">
        <p className="text-xl font-semibold tracking-tight text-balance text-content sm:text-2xl">
          {title}
        </p>
        <p className="mt-1.5 text-sm text-balance text-content-muted">{hint}</p>

        {/*
         * The track is a plain div rather than <progress>, which cannot be
         * styled consistently across browsers. The ARIA attributes carry the
         * same meaning, and are omitted entirely while indeterminate so a
         * screen reader is not told a value that does not exist.
         */}
        <div
          className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-accent/15"
          role="progressbar"
          aria-valuemin={determinate ? 0 : undefined}
          aria-valuemax={determinate ? 100 : undefined}
          aria-valuenow={determinate ? pct : undefined}
          aria-valuetext={determinate ? undefined : hint}
        >
          {determinate ? (
            // Width transition rather than an animation: each step is a real
            // upload finishing, so it should move when one does and hold still
            // when nothing is happening.
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(pct, 6)}%` }}
            />
          ) : (
            // Nothing measurable to show — a sweep, so the bar reads as busy
            // rather than as stuck at zero.
            <div className="submitting-sweep h-full w-2/5 rounded-full bg-accent" />
          )}
        </div>
      </div>
    </div>
  );
}
