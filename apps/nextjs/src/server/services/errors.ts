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

  constructor(opts: {
    provider: "sarvam" | "openai";
    message: string;
    userMessage: string;
    retryable: boolean;
    status?: number;
    contentError?: boolean;
  }) {
    super(opts.message);
    this.name = "ProviderError";
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.userMessage = opts.userMessage;
    this.status = opts.status;
    this.contentError = opts.contentError ?? false;
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
 * Retry with exponential backoff, but only for errors marked retryable.
 * Deliberately small: this runs inside a request, not a background worker.
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
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)),
      );
    }
  }
  throw lastError;
}
