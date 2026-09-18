import "server-only";

import { env } from "~/env";
import { ProviderError, isRetryableStatus, withRetry } from "./errors";
import { recordUsage } from "~/server/interview/usage";
import { timed } from "./timing";

const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

const SARVAM_BASE_URL = "https://api.sarvam.ai";
// Kept tight on purpose. `withRetry`'s default (3 attempts) multiplies these,
// and the two together were the actual cause of multi-minute stalls: a slow
// Sarvam response used to mean up to 60s x 3 = 180s for one transcription —
// landing squarely on `STALE_PROCESSING_MS` and only "recovering" via that
// timeout, which is what looked like the interview doing nothing for minutes.
// A healthy STT/TTS call returns in 1-3s. These caps decide how long a
// DEGRADED Sarvam wastes on the candidate's critical path. On a bad Sarvam day
// STT (hang) then TTS (hang) on the same turn stacked to ~50s of dead wait, so
// both are kept short and low-retry: fail fast, don't make the candidate sit.
const STT_TIMEOUT_MS = 10_000;
const TTS_TIMEOUT_MS = 8_000;
/** STT is the answer — worth one retry for a transient blip. */
const RETRY_OPTS = { attempts: 2, baseDelayMs: 300 };
/**
 * TTS is not: a failure just means the question shows as text with a retry
 * button, never a lost answer. One try, so a hang costs 8s, not 24s. The inner
 * language_code -> target_language_code fallback still gives real 400s a second
 * shot; this only stops RE-trying a plain hang.
 */
const TTS_RETRY_OPTS = { attempts: 1, baseDelayMs: 300 };

/** bulbul:v3 caps at 2500 chars; stay well under and never send more. */
const TTS_MAX_CHARS = 1500;

/**
 * The interviewer's natural speaking rate.
 *
 * 1.0 is the model's own pace. A candidate who wants it slower asks, and that
 * is handled on the client with `playbackRate` so it applies to clips that
 * were voiced before they asked — re-synthesising would only fix the next one.
 */
const DEFAULT_TTS_PACE = 1;

function authHeaders(): Record<string, string> {
  // Header name per Sarvam docs. Never logged — see `logProviderFailure`.
  return { "api-subscription-key": env.SARVAM_API_KEY };
}

/** Logs a provider failure without ever emitting the key or auth headers. */
function logProviderFailure(op: string, status: number, bodyExcerpt: string) {
  console.error(
    `[sarvam] ${op} failed status=${status} body=${bodyExcerpt.slice(0, 300)}`,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  op: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ProviderError({
      provider: "sarvam",
      message: `${op} ${aborted ? "timed out" : "network error"}`,
      userMessage: aborted
        ? "The speech service took too long to respond. Please try again."
        : "Could not reach the speech service. Check your connection and try again.",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/*                               Speech-to-Text                               */
/* -------------------------------------------------------------------------- */

export interface TranscriptionResult {
  transcript: string;
  /** What Sarvam heard. Present when `language_code: "unknown"` was sent. */
  languageCode: string | null;
  /** 0-1 confidence in that detection, when reported. */
  languageProbability: number | null;
}

/**
 * Transcribe a recorded answer.
 *
 * POST https://api.sarvam.ai/speech-to-text (multipart/form-data)
 */
export async function transcribeAudio(input: {
  audio: Buffer;
  mimeType: string;
  /** BCP-47 code from the session language. Never read from env here. */
  languageCode: string;
  fileName?: string;
}): Promise<TranscriptionResult> {
  const run = async (): Promise<TranscriptionResult> => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
      input.fileName ?? "answer.webm",
    );
    form.append("model", env.SARVAM_STT_MODEL);
    form.append("language_code", input.languageCode);
    // `mode` is intentionally left at its default ("transcribe"). Sending
    // "translate" would return English and destroy the candidate's original
    // words, which must be preserved verbatim.

    const response = await fetchWithTimeout(
      `${SARVAM_BASE_URL}/speech-to-text`,
      { method: "POST", headers: authHeaders(), body: form },
      STT_TIMEOUT_MS,
      "speech-to-text",
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logProviderFailure("speech-to-text", response.status, body);

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError({
          provider: "sarvam",
          message: "speech-to-text authentication failed",
          userMessage:
            "The speech service rejected our credentials. Please contact support.",
          retryable: false,
          status: response.status,
        });
      }
      if (response.status === 415 || response.status === 422) {
        throw new ProviderError({
          provider: "sarvam",
          message: "speech-to-text unsupported audio format",
          userMessage:
            "That recording format could not be processed. Please re-record your answer.",
          retryable: false,
          status: response.status,
        });
      }
      throw new ProviderError({
        provider: "sarvam",
        message: `speech-to-text failed with status ${response.status}`,
        userMessage:
          "We could not transcribe your answer just now. Please try again.",
        retryable: isRetryableStatus(response.status),
        status: response.status,
      });
    }

    const json = (await response.json().catch(() => null)) as {
      transcript?: unknown;
      language_code?: unknown;
      language_probability?: unknown;
    } | null;

    const transcript =
      typeof json?.transcript === "string" ? json.transcript.trim() : "";

    return {
      transcript,
      languageCode:
        typeof json?.language_code === "string" ? json.language_code : null,
      languageProbability:
        typeof json?.language_probability === "number"
          ? json.language_probability
          : null,
    };
  };

  // Billed per request against the audio sent, so both are recorded.
  recordUsage({ sttRequests: 1, sttAudioBytes: input.audio.length });

  return timed(
    "stt.sarvam",
    () => withRetry(run, RETRY_OPTS),
    () => `in=${kb(input.audio.length)}`,
  );
}

/* -------------------------------------------------------------------------- */
/*                               Text-to-Speech                               */
/* -------------------------------------------------------------------------- */

export interface SpeechResult {
  audio: Buffer;
  mimeType: string;
}

/**
 * Synthesise a question to audio.
 *
 * POST https://api.sarvam.ai/text-to-speech/stream -> a binary MP3 stream.
 *
 * The streaming endpoint (not the plain /text-to-speech one) is used for two
 * reasons: it returns MP3 rather than the plain endpoint's uncompressed WAV —
 * roughly a tenth of the bytes, so the R2 store and the candidate's download
 * both shrink from seconds to near-instant, which was most of the "the voice
 * is behind the text" lag AND the bad-internet audio stall — and it can later
 * be consumed chunk-by-chunk for true streaming without another API change.
 * We still buffer the whole response here; that is a smaller, separate step.
 *
 * The current docs name the language field `language_code`; older/v2 accounts
 * expect `target_language_code`. We send the documented name and retry once
 * with the legacy name if the API rejects the body, so either account shape
 * works without a config change.
 */
export async function generateSpeech(
  text: string,
  options: {
    languageCode: string;
    speaker?: string;
    /**
     * Speaking rate, 1.0 being the model's own.
     *
     * Was pinned at 0.9 in the request body to make questions easier to
     * follow. It made the interviewer sound laboured — the clip is ~19%
     * longer at 0.9 than at 1.0 on the same sentence — so the default is
     * back to natural and slowing down is now something a candidate asks
     * for, applied per attempt.
     */
    pace?: number;
  },
): Promise<SpeechResult> {
  const clipped = text.trim().slice(0, TTS_MAX_CHARS);
  if (!clipped) {
    throw new ProviderError({
      provider: "sarvam",
      message: "text-to-speech called with empty text",
      userMessage: "There was no question text to read aloud.",
      retryable: false,
    });
  }

  const attempt = async (languageField: string): Promise<SpeechResult> => {
    const response = await fetchWithTimeout(
      `${SARVAM_BASE_URL}/text-to-speech/stream`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clipped,
          [languageField]: options.languageCode,
          speaker: options.speaker ?? env.SARVAM_TTS_SPEAKER,
          model: env.SARVAM_TTS_MODEL,
          // MP3 instead of the default WAV — ~10x smaller to store and send.
          output_audio_codec: "mp3",
          pace: options.pace ?? DEFAULT_TTS_PACE,
        }),
      },
      TTS_TIMEOUT_MS,
      "text-to-speech",
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logProviderFailure("text-to-speech", response.status, body);

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError({
          provider: "sarvam",
          message: "text-to-speech authentication failed",
          userMessage: "Question audio is unavailable right now.",
          retryable: false,
          status: response.status,
        });
      }
      throw new ProviderError({
        provider: "sarvam",
        message: `text-to-speech failed with status ${response.status}`,
        userMessage: "Question audio is unavailable right now.",
        retryable: isRetryableStatus(response.status),
        status: response.status,
      });
    }

    // The /stream endpoint returns the audio as a raw binary body, not JSON —
    // read the whole thing into a buffer (still a smaller MP3 than the old WAV).
    const audio = Buffer.from(await response.arrayBuffer());

    if (audio.length === 0) {
      throw new ProviderError({
        provider: "sarvam",
        message: "text-to-speech returned no audio",
        userMessage: "Question audio is unavailable right now.",
        retryable: true,
      });
    }

    return { audio, mimeType: "audio/mpeg" };
  };

  // `clipped`, not the caller's text: TTS is billed on what is sent, and
  // anything past TTS_MAX_CHARS was cut before the request.
  recordUsage({ ttsCharacters: clipped.length });

  let out: SpeechResult | null = null;
  return timed(
    "tts.sarvam",
    async () => {
      out = await withRetry(async () => {
        try {
          return await attempt("language_code");
        } catch (error) {
          const rejectedBody =
            error instanceof ProviderError &&
            (error.status === 400 || error.status === 422);
          if (!rejectedBody) throw error;
          return attempt("target_language_code");
        }
      }, TTS_RETRY_OPTS);
      return out;
    },
    () => `chars=${clipped.length}${out ? ` out=${kb(out.audio.length)}` : ""}`,
  );
}
