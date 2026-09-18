import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { interviewAttemptsTable } from "~/server/db/schema";

/**
 * What each interview cost to run.
 *
 * Every external leg is billed on its own unit — TTS per character, the
 * models per token, STT per request — so each is counted in the unit it is
 * actually billed in and the arithmetic is left to whoever is doing the
 * costing. Prices change and differ per account; a column of rupees would be
 * wrong within a month.
 *
 * The attempt is carried in `AsyncLocalStorage` rather than threaded through
 * every provider signature. Those functions are three and four layers below
 * the code that knows which attempt is running, and adding an id parameter to
 * all of them — plus every call site — to serve a counter would be a large,
 * noisy change for a small feature. A scope set at the few entry points in
 * `~/server/attempt/service` covers everything beneath it, including legs
 * added later, for free.
 *
 * Outside a scope every call here is a no-op: a script, a test or an admin
 * request that reaches a provider records nothing rather than guessing an
 * attempt to bill.
 */

interface UsageDelta {
  sttRequests?: number;
  sttAudioBytes?: number;
  ttsCharacters?: number;
  llmRequests?: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
}

const scope = new AsyncLocalStorage<{ attemptId: string }>();

/** Run `fn` with provider usage attributed to this attempt. */
export function withUsageScope<T>(
  attemptId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return scope.run({ attemptId }, fn);
}

/**
 * Add to the running totals for whichever attempt is in scope.
 *
 * Fire-and-forget by design: this is bookkeeping, and an interview must never
 * fail — or even wait — because a counter could not be written. Incremented in
 * SQL so the concurrent legs of one turn cannot overwrite each other.
 */
export function recordUsage(delta: UsageDelta): void {
  const current = scope.getStore();
  if (!current) return;

  const set: Record<string, unknown> = {};
  if (delta.sttRequests) {
    set.sttRequests = sql`${interviewAttemptsTable.sttRequests} + ${delta.sttRequests}`;
  }
  if (delta.sttAudioBytes) {
    set.sttAudioBytes = sql`${interviewAttemptsTable.sttAudioBytes} + ${delta.sttAudioBytes}`;
  }
  if (delta.ttsCharacters) {
    set.ttsCharacters = sql`${interviewAttemptsTable.ttsCharacters} + ${delta.ttsCharacters}`;
  }
  if (delta.llmRequests) {
    set.llmRequests = sql`${interviewAttemptsTable.llmRequests} + ${delta.llmRequests}`;
  }
  if (delta.llmInputTokens) {
    set.llmInputTokens = sql`${interviewAttemptsTable.llmInputTokens} + ${delta.llmInputTokens}`;
  }
  if (delta.llmOutputTokens) {
    set.llmOutputTokens = sql`${interviewAttemptsTable.llmOutputTokens} + ${delta.llmOutputTokens}`;
  }
  if (Object.keys(set).length === 0) return;

  void db
    .update(interviewAttemptsTable)
    .set(set)
    .where(eq(interviewAttemptsTable.id, current.attemptId))
    .catch((error: unknown) => {
      console.error(
        `[usage] could not record for ${current.attemptId}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    });
}
