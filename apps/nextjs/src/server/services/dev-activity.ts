import "server-only";

import { env } from "~/env";

/**
 * Which external service served each leg of the interview — development only.
 *
 * Three things make this worth showing in the browser rather than only in the
 * terminal. `AI_PROVIDER=sarvam` does not mean Sarvam answered: the dispatch in
 * `./openai` falls back to OpenAI when Sarvam fails and then skips it for
 * minutes, silently. The speech legs are a different provider again. And the
 * question "why did that turn take so long" is really "which of brain, STT and
 * TTS was slow", which no single number answers.
 *
 * Everything is recorded from `timed()`, the one seam all three legs already
 * pass through, so nothing in `openai.ts` or `sarvam.ts` had to change and any
 * future `timed()` call is picked up for free.
 *
 * Deliberately in-memory and process-wide rather than per-attempt: it is a
 * developer's readout on their own machine, not attempt data, so it needs no
 * schema change and no plumbing of an attempt id through every call site. It is
 * cleared when a DIFFERENT attempt opens the interview page (see
 * `beginActivitySession`) so one sitting never shows the previous one's calls.
 *
 * Nothing here is recorded in production: `recordActivity` returns immediately
 * and `recentActivity` returns an empty array, so the field never reaches a
 * real candidate's browser.
 */

/** Which leg of the pipeline. "other" covers storage and anything new. */
export type ActivitySection = "brain" | "stt" | "tts" | "other";

export interface ActivityEvent {
  /** Epoch ms, so the client can render a wall-clock time. */
  at: number;
  section: ActivitySection;
  /** "Sarvam", "OpenAI", or "OpenAI (fallback)" — what actually served it. */
  provider: string;
  /** The model or voice that ran, read from the environment. */
  model: string;
  /** What was asked for: the prompt name, or the storage operation. */
  detail: string;
  ms: number;
  ok: boolean;
}

const isDev = env.NODE_ENV === "development";

/** Enough for several turns of scrollback; oldest fall off the front. */
const MAX_ENTRIES = 60;

const events: ActivityEvent[] = [];

/** `openai-fallback` is the one that matters most, so it keeps its own label. */
function providerLabel(raw: string): string {
  if (raw === "openai-fallback") return "OpenAI (fallback)";
  if (raw === "openai") return "OpenAI";
  if (raw === "sarvam") return "Sarvam";
  return raw;
}

/**
 * Work out which model ran, from the environment rather than the call site.
 *
 * The alternative was threading a model name through `timed()` at every call
 * site; this keeps the instrumentation to one file at the cost of repeating
 * the same `kind`-to-model rule that `sarvam-chat.ts` applies.
 */
function modelFor(
  section: ActivitySection,
  provider: string,
  kind: string,
): string {
  if (section === "stt") return env.SARVAM_STT_MODEL;
  if (section === "tts")
    return `${env.SARVAM_TTS_MODEL} · ${env.SARVAM_TTS_SPEAKER}`;
  if (section !== "brain") return "";
  if (provider === "sarvam") {
    return kind === "analysis"
      ? env.SARVAM_ANALYSIS_MODEL
      : env.SARVAM_CHAT_MODEL;
  }
  return env.OPENAI_MODEL;
}

/**
 * Turn a `timed()` label into a section, provider and detail.
 *
 * Labels are `llm.<provider>.<kind>.<schema>`, `stt.<provider>`,
 * `tts.<provider>`, or anything else (storage, today). Parsing them here keeps
 * the label the single source of truth rather than duplicating it as extra
 * arguments at every call site.
 */
function parse(label: string): Omit<ActivityEvent, "at" | "ms" | "ok"> {
  const parts = label.split(".");
  const head = parts[0];

  if (head === "llm") {
    const provider = parts[1] ?? "unknown";
    const kind = parts[2] ?? "";
    const schema = parts[3] ?? "";
    return {
      section: "brain",
      provider: providerLabel(provider),
      model: modelFor("brain", provider, kind),
      detail: schema || kind,
    };
  }

  if (head === "stt" || head === "tts") {
    const provider = parts[1] ?? "sarvam";
    return {
      section: head,
      provider: providerLabel(provider),
      model: modelFor(head, provider, ""),
      detail: head === "stt" ? "transcribe" : "speak",
    };
  }

  return { section: "other", provider: "—", model: "", detail: label };
}

/** Record one timed leg. No-op outside development. */
export function recordActivity(label: string, ms: number, ok: boolean): void {
  if (!isDev) return;
  events.push({ ...parse(label), at: Date.now(), ms, ok });
  if (events.length > MAX_ENTRIES) {
    events.splice(0, events.length - MAX_ENTRIES);
  }
}

/** Most recent events, oldest first. Always empty outside development. */
export function recentActivity(): ActivityEvent[] {
  if (!isDev) return [];
  return events.slice();
}

/** The attempt the buffer currently holds events for. */
let currentAttemptId: string | null = null;

/**
 * Start (or continue) recording for one attempt, clearing another's events.
 *
 * The buffer lives as long as the dev server, so without this a fresh attempt
 * inherited the previous one's entries and the readout showed turns from an
 * interview that had already finished.
 *
 * Keyed on the attempt rather than clearing on every page render, because the
 * interview page re-renders mid-sitting — `revalidatePath` after a language
 * change, for one — and wiping the history each time would throw away the
 * turns you are trying to read.
 */
export function beginActivitySession(attemptId: string): void {
  if (!isDev) return;
  if (currentAttemptId === attemptId) return;
  currentAttemptId = attemptId;
  events.length = 0;
}
