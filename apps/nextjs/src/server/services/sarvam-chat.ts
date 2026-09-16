import "server-only";

import type { z } from "zod";

import { env } from "~/env";
import { ProviderError, isRetryableStatus, withRetry } from "./errors";

/**
 * Sarvam chat completions — the interview "brain".
 *
 * This is the Sarvam-backed half of the structured-JSON seam that `openai.ts`
 * used to own alone. Both providers expose the same
 * `{ instructions, input, jsonSchema, validator } -> T` contract, so which one
 * runs is a single environment switch (`AI_PROVIDER`) and no caller changes.
 * See `requestStructured` in `./openai.ts` for the dispatch.
 *
 * Two models, chosen per call site by `kind`:
 *   - conversation: live interview turns (questions, follow-ups, re-asks)
 *   - analysis:     scoring and the closing report
 */

const SARVAM_BASE_URL = "https://api.sarvam.ai";

/**
 * Far longer than the OpenAI equivalent (20s), and deliberately so.
 *
 * Measured against the real turn payload, `sarvam-105b-conversations` returns
 * a scored turn plus the next question in 28-35s. A 20s budget would time out
 * nearly every call. `withRetry` multiplies this, so it is paired with a low
 * attempt count below.
 */
// A healthy conversation call returns in ~28-35s. This caps a DEGRADED one:
// past 45s it is not coming back usefully, so abort and let `requestStructured`
// fall back to OpenAI rather than make the candidate wait minutes. (Was 90s,
// which on a bad Sarvam day meant a 90s timeout + retry + non-JSON ≈ 136s
// before the interview even errored.)
const CHAT_TIMEOUT_MS = 45_000;

/** Reasoning models spend most of their budget before the first content token. */
const ANALYSIS_TIMEOUT_MS = 150_000;

/**
 * Conversation: no retry — one 45s try, then the OpenAI fallback takes over, so
 * a second Sarvam attempt would only add 45s of dead wait on the candidate's
 * critical path. Analysis is background (nobody waits) so it keeps a retry.
 */
const CHAT_RETRY_OPTS = { attempts: 1, baseDelayMs: 500 };
const ANALYSIS_RETRY_OPTS = { attempts: 2, baseDelayMs: 500 };

/**
 * Token ceilings.
 *
 * `conversation` returns a scored turn and one question — ~370 tokens
 * measured, so 1500 is generous. `analysis` is a reasoning model: it emitted
 * 5092 characters of `reasoning_content` before any answer in testing, and
 * that spend counts against the same budget, so it needs far more headroom.
 */
const CONVERSATION_MAX_TOKENS = 1500;
const ANALYSIS_MAX_TOKENS = 8000;

export type SarvamChatKind = "conversation" | "analysis";

function authHeaders(): Record<string, string> {
  // Sarvam's chat endpoint is OpenAI-compatible and takes a bearer token,
  // unlike the STT/TTS endpoints which use `api-subscription-key`.
  return { Authorization: `Bearer ${env.SARVAM_API_KEY}` };
}

/** Logs a provider failure without ever emitting the key or auth headers. */
function logProviderFailure(op: string, status: number, bodyExcerpt: string) {
  console.error(
    `[sarvam-chat] ${op} failed status=${status} body=${bodyExcerpt.slice(0, 300)}`,
  );
}

function modelFor(kind: SarvamChatKind): string {
  return kind === "analysis"
    ? env.SARVAM_ANALYSIS_MODEL
    : env.SARVAM_CHAT_MODEL;
}

/**
 * Describe the expected object shape in prose for the prompt.
 *
 * Sarvam accepts `response_format: { type: "json_schema" }` but does not
 * honour it usefully: with `strict: true` one probe ran away, hit the token
 * ceiling and returned unparseable output, and another silently answered in
 * English when the interview language was Telugu. `json_object` was stable
 * across probes and preserved the interview language, but it guarantees only
 * *some* object — not ours. So the shape is restated in the prompt, derived
 * from the SAME hand-written JSON Schema the OpenAI path sends, which keeps
 * one source of truth and stops the two providers drifting apart.
 */
function describeShape(jsonSchema: Record<string, unknown>): string {
  const properties = (jsonSchema.properties ?? {}) as Record<
    string,
    { type?: unknown; description?: string }
  >;
  const required = new Set(
    Array.isArray(jsonSchema.required) ? (jsonSchema.required as string[]) : [],
  );

  const lines = Object.entries(properties).map(([key, spec]) => {
    const type = Array.isArray(spec.type)
      ? (spec.type as string[]).join(" or ")
      : String(spec.type ?? "string");
    const flag = required.has(key) ? "required" : "optional";
    const note = spec.description ? ` — ${spec.description}` : "";
    return `- "${key}" (${type}, ${flag})${note}`;
  });

  return [
    "Reply with a single JSON object and nothing else.",
    "No markdown, no code fences, no commentary before or after it.",
    "It must have exactly these keys:",
    ...lines,
  ].join("\n");
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Even under `json_object` the model sometimes wraps the object in a fenced
 * code block, so the fence is stripped first; falling back to the outermost
 * brace pair covers any remaining prose on either side.
 */
function extractJson(raw: string): string {
  const text = raw.trim();

  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(text);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text;
}

interface ChatResponse {
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string;
  }[];
}

/**
 * Structured JSON request against Sarvam, matching the OpenAI helper's
 * contract exactly so the two are interchangeable.
 */
export async function requestStructuredViaSarvam<T>(args: {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  kind: SarvamChatKind;
}): Promise<T> {
  const { kind } = args;
  const timeoutMs = kind === "analysis" ? ANALYSIS_TIMEOUT_MS : CHAT_TIMEOUT_MS;

  const run = async (): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${SARVAM_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelFor(kind),
          messages: [
            {
              role: "system",
              content: `${args.instructions}\n\n${describeShape(args.jsonSchema)}`,
            },
            { role: "user", content: args.input },
          ],
          max_tokens:
            kind === "analysis" ? ANALYSIS_MAX_TOKENS : CONVERSATION_MAX_TOKENS,
          response_format: { type: "json_object" },
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ProviderError({
        provider: "sarvam",
        message: `chat-completions ${aborted ? "timed out" : "network error"}`,
        userMessage: aborted
          ? "The interviewer took too long to respond. Please try again."
          : "Could not reach the interviewer service. Check your connection and try again.",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logProviderFailure(args.schemaName, response.status, body);

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError({
          provider: "sarvam",
          message: "chat-completions authentication failed",
          userMessage: "AI interviews are not configured correctly.",
          retryable: false,
          status: response.status,
        });
      }
      throw new ProviderError({
        provider: "sarvam",
        message: `chat-completions failed with status ${response.status}`,
        userMessage:
          "We could not reach the interviewer. Please try again in a moment.",
        retryable: isRetryableStatus(response.status),
        status: response.status,
      });
    }

    const json = (await response
      .json()
      .catch(() => null)) as ChatResponse | null;
    const choice = json?.choices?.[0];
    const raw = choice?.message?.content;

    // A reasoning model that spends its whole budget thinking returns null
    // content with finish_reason "length". Worth its own message: that means
    // the token ceiling is too low, not that the service is down.
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new ProviderError({
        provider: "sarvam",
        message: `chat-completions returned no content (finish_reason=${choice?.finish_reason ?? "unknown"})`,
        userMessage:
          "We could not read the interviewer response. Please try again.",
        retryable: true,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      throw new ProviderError({
        provider: "sarvam",
        message: "chat-completions returned non-JSON output",
        userMessage:
          "We could not read the interviewer response. Please try again.",
        retryable: true,
      });
    }

    const result = args.validator.safeParse(parsed);
    if (!result.success) {
      console.error(
        `[sarvam-chat] structured response failed validation: ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.code}`)
          .join("; ")}`,
      );
      throw new ProviderError({
        provider: "sarvam",
        message: "chat-completions response failed schema validation",
        userMessage:
          "We could not read the interviewer response. Please try again.",
        retryable: true,
      });
    }
    return result.data;
  };

  return withRetry(
    run,
    kind === "analysis" ? ANALYSIS_RETRY_OPTS : CHAT_RETRY_OPTS,
  );
}
