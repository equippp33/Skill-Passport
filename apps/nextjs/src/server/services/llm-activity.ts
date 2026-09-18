import "server-only";

import { env } from "~/env";

/**
 * Which model actually answered — a development-only readout.
 *
 * `AI_PROVIDER=sarvam` does not mean Sarvam served the turn: `requestStructured`
 * falls back to OpenAI when Sarvam fails, and the circuit breaker then skips
 * Sarvam entirely for a few minutes. That is the right behaviour in front of a
 * candidate, but while developing it hides the thing you most want to see, and
 * the `[timing]` lines only show it in the terminal — not to whoever is sitting
 * the interview in the browser.
 *
 * So each structured call records what served it here, and the status poll
 * hands the recent ones to the interview screen, which shows a small badge.
 *
 * Deliberately in-memory and process-wide rather than per-attempt: it is a
 * developer's readout on their own machine, not attempt data, so it needs no
 * schema change, no plumbing of an attempt id through every call site, and it
 * disappears on restart. That does mean two people interviewing against ONE dev
 * server would see each other's entries — fine for its purpose, and the reason
 * it is hard-disabled outside development.
 *
 * Nothing here is recorded in production: `record` returns immediately and
 * `recentLlmCalls` returns an empty array, so the field never reaches a real
 * candidate's browser.
 */

export interface LlmCall {
  /** Epoch ms, so the client can show "just now" without a clock skew fight. */
  at: number;
  /**
   * "sarvam" — Sarvam answered.
   * "openai" — AI_PROVIDER=openai, so OpenAI was the intended provider.
   * "openai-fallback" — Sarvam was selected but OpenAI answered instead.
   */
  provider: "sarvam" | "openai" | "openai-fallback";
  /** "conversation" (live turn) or "analysis" (scoring, report). */
  kind: string;
  /** Which prompt: interview_turn, interview_summary, translated_question. */
  schemaName: string;
  ms: number;
  ok: boolean;
  /** Why a fallback happened, when one did. Never contains a key or a prompt. */
  note?: string;
}

const isDev = env.NODE_ENV === "development";

/** Enough to cover a few turns of scrollback; oldest fall off the front. */
const MAX_ENTRIES = 24;

const calls: LlmCall[] = [];

/** Record one structured LLM call. No-op outside development. */
export function recordLlmCall(call: Omit<LlmCall, "at">): void {
  if (!isDev) return;
  calls.push({ ...call, at: Date.now() });
  if (calls.length > MAX_ENTRIES) calls.splice(0, calls.length - MAX_ENTRIES);
}

/** Most recent calls, newest last. Always empty outside development. */
export function recentLlmCalls(): LlmCall[] {
  if (!isDev) return [];
  return calls.slice();
}

/**
 * Forget everything recorded so far.
 *
 * Called when the interview page loads, so the panel shows THIS sitting only.
 * The buffer lives as long as the dev server, so without this a fresh attempt
 * opened on the same process inherited the previous one's entries and the
 * readout showed turns from an interview that had already finished.
 */
export function resetLlmCalls(): void {
  if (!isDev) return;
  calls.length = 0;
}
