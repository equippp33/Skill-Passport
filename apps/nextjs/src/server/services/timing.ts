import "server-only";

/**
 * Wrap an async call and log how long it took.
 *
 * The interview has four external legs — LLM generation, LLM scoring, STT and
 * TTS — and until now none of them were timed, so "it's slow" could not be
 * pinned to one. Every leg goes through a single seam, so wrapping those seams
 * makes the slow one show up in the `next dev` terminal (and server logs) as
 * `[timing] <label> <ms>`.
 *
 * ponytail: console-only, no metrics backend. Read it in the terminal; if this
 * ever needs aggregation, pipe these lines somewhere — do not build a collector.
 */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  /** Optional extra context appended to the line, e.g. payload size. */
  detail?: () => string,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - start);
    console.log(`[timing] ${label} ${ms}ms${detail ? ` ${detail()}` : ""}`);
  }
}
