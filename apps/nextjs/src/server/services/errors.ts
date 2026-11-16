import "server-only";

/**
 * Error type shared by the external-provider services.
 *
 * `retryable` distinguishes a transient provider problem (5xx, 429, timeout)
 * from a permanent one (bad credentials, unsupported audio). Only the former
 * is worth retrying automatically.
 *
 * `userMessage` is the ONLY text that may be shown to a candidate — provider
 * responses can echo request content and must not be surfaced raw.
 */
export class ProviderError extends Error {
  readonly provider: "sarvam" | "openai";
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly status?: number;
  /**
   * The provider was REACHED but its reply was unusable (empty, non-JSON, or
   * failed schema validation) — a content quirk, not an outage. Callers use this
   * to avoid tripping the Sarvam circuit breaker on a one-off bad response:
   * disabling a healthy provider for minutes over a format hiccup only pushes
   * load onto the fallback.
   */
  readonly contentError: boolean;
  /**
   * How long the provider asked us to wait before trying again, from its
   * `Retry-After` header on a 429/503. Undefined when it gave no hint.
   */
  readonly retryAfterMs?: number;

  constructor(opts: {
    provider: "sarvam" | "openai";
    message: string;
    userMessage: string;
    retryable: boolean;
    status?: number;
    contentError?: boolean;
    retryAfterMs?: number;
  }) {
    super(opts.message);
    this.name = "ProviderError";
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.userMessage = opts.userMessage;
    this.status = opts.status;
    this.contentError = opts.contentError ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Sanitised message for any error that escapes to the UI. */
export function toUserMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.userMessage;
  return "Something went wrong while processing your answer. Please try again.";
}

/**
 * Milliseconds a `Retry-After` header asks for, or undefined.
 *
 * The header is either a number of seconds or an HTTP date; anything else
 * (absent, malformed, in the past) is treated as no hint.
 */
export function parseRetryAfter(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  const ms = at - Date.now();
  return ms > 0 ? ms : undefined;
}

/**
 * The shortest pause after a rate-limit (429) response.
 *
 * A rate limit is a "slow down", not a blip: retrying after the normal 500 ms
 * lands in the same window and burns the retry. Providers that send no
 * `Retry-After` get this instead.
 */
const RATE_LIMIT_MIN_DELAY_MS = 2_000;

/**
 * The longest this helper will ever sleep between attempts.
 *
 * It runs inside a request, often with a candidate waiting. If a provider
 * asks for longer than this, waiting is worse than failing over (OpenAI for
 * the LLM) or showing the retry message, so the error is thrown at once.
 */
const MAX_RETRY_DELAY_MS = 8_000;

/** How long to wait before attempt `attempt + 1`, or null to stop retrying. */
function retryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
): number | null {
  const backoff = baseDelayMs * 2 ** (attempt - 1);
  if (!(error instanceof ProviderError)) return backoff;

  const rateLimited = error.status === 429;
  const asked = error.retryAfterMs;
  if (asked !== undefined && asked > MAX_RETRY_DELAY_MS) return null;

  const floor = rateLimited ? RATE_LIMIT_MIN_DELAY_MS : 0;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff, floor, asked ?? 0));
}

/**
 * Retry with exponential backoff, but only for errors marked retryable.
 * Deliberately small: this runs inside a request, not a background worker.
 *
 * Rate limits are respected: a 429 waits at least
 * {@link RATE_LIMIT_MIN_DELAY_MS}, and any `Retry-After` the provider sent is
 * honoured up to {@link MAX_RETRY_DELAY_MS}. A longer requested wait ends the
 * retries immediately so the caller can fail over instead of hanging.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ProviderError ? error.retryable : false;
      if (!retryable || attempt === attempts) throw error;
      const delay = retryDelayMs(error, attempt, baseDelayMs);
      if (delay === null) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
