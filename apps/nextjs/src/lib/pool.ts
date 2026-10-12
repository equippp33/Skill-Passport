/**
 * Run `work` over `items`, never more than `limit` at a time.
 *
 * The obvious alternative — slicing into chunks of `limit` and awaiting each
 * chunk — looks equivalent and is not. A chunk finishes when its SLOWEST
 * member finishes, so three calls that take 10 seconds sit idle waiting for a
 * fourth that takes 31. Measured on a real re-score, that waste was 40% of
 * the wall time: 100 seconds of chunking against 59 of actual capacity.
 *
 * Here each worker takes the next item the moment it is free, so the only
 * idle time is at the very end.
 *
 * Never rejects. Results come back positionally, in the shape of
 * `Promise.allSettled`, so one failure cannot abandon the rest of the queue —
 * which matters when the queue is hundreds of candidates long.
 */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        try {
          results[index] = {
            status: "fulfilled",
            value: await work(items[index]!, index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}
