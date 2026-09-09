import "server-only";

import { env } from "~/env";
import { ProviderError, isRetryableStatus, withRetry } from "./errors";

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const STT_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 30_000;

/** bulbul:v3 caps at 2500 chars; stay well under and never send more. */
const TTS_MAX_CHARS = 1500;

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

  return withRetry(run);
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
 * POST https://api.sarvam.ai/text-to-speech -> `{ audios: [base64] }` (WAV).
 *
 * The current docs name the language field `language_code`; older/v2 accounts
 * expect `target_language_code`. We send the documented name and retry once
 * with the legacy name if the API rejects the body, so either account shape
 * works without a config change.
 */
export async function generateSpeech(
  text: string,
  options: { languageCode: string; speaker?: string },
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
      `${SARVAM_BASE_URL}/text-to-speech`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clipped,
          [languageField]: options.languageCode,
          speaker: options.speaker ?? env.SARVAM_TTS_SPEAKER,
          model: env.SARVAM_TTS_MODEL,
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

    const json = (await response.json().catch(() => null)) as {
      audios?: unknown;
    } | null;
    const first = Array.isArray(json?.audios) ? json.audios[0] : null;

    if (typeof first !== "string" || first.length === 0) {
      throw new ProviderError({
        provider: "sarvam",
        message: "text-to-speech returned no audio",
        userMessage: "Question audio is unavailable right now.",
        retryable: true,
      });
    }

    return { audio: Buffer.from(first, "base64"), mimeType: "audio/wav" };
  };

  return withRetry(async () => {
    try {
      return await attempt("language_code");
    } catch (error) {
      const rejectedBody =
        error instanceof ProviderError &&
        (error.status === 400 || error.status === 422);
      if (!rejectedBody) throw error;
      return attempt("target_language_code");
    }
  });
}
