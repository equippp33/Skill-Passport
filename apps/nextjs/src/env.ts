import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Relative, not the "~/" alias: next.config.ts imports this file and Next
// compiles that config outside the tsconfig path mapping, so an aliased
// import here fails the build with MODULE_NOT_FOUND.
import {
  TRANSLATED_LANGUAGE_KEYS,
  isTranslatedLanguageKey,
} from "./config/languages";

/**
 * Runtime environment contract for the web app.
 *
 * Everything here is `server`-scoped on purpose: no interview provider key may
 * ever reach the browser bundle. Adding a key to `client` would inline it into
 * the JS payload, so API keys must never be moved there.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    /**
     * Postgres connections per app instance. Keep
     * (instances x this) comfortably below the server max_connections.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    /**
     * Override for the origin used in candidate links.
     *
     * Not needed for either normal case: development reads the origin off
     * the request, and production uses the domain compiled into
     * `~/server/app-url`. Set this for anything else — a staging host, or a
     * domain change you would rather not rebuild for.
     *
     * A trailing slash is stripped, so links never double up.
     */
    APP_URL: z
      .string()
      .url()
      .optional()
      .transform((v) => v?.replace(/\/+$/, "")),

    /**
     * Which provider runs the interview "brain" — question generation,
     * follow-ups, answer evaluation and the closing report.
     *
     * Speech (Sarvam STT/TTS) is unaffected either way; this switches only
     * the reasoning layer. Both implementations satisfy the same structured
     * -JSON contract, so flipping this value is the whole migration in
     * either direction. See `requestStructured` in
     * `~/server/services/openai`.
     */
    AI_PROVIDER: z.enum(["sarvam", "openai"]).default("sarvam"),

    // --- OpenAI (question generation + answer evaluation) ---
    /**
     * Optional so the app boots and can be clicked through without it.
     * Without it the site works but interviews cannot start — the server
     * returns a clear "not configured" message and the UI shows a banner.
     * See `isOpenAIConfigured()` in `~/server/services/openai`.
     *
     * Currently unused: `AI_PROVIDER` defaults to "sarvam". Kept wired up so
     * switching back to GPT needs no code change.
     */
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),

    /**
     * Language of the INTERVIEW CONTENT: questions, follow-ups, Sarvam STT,
     * Sarvam TTS, answer evaluation, per-answer feedback and the final report.
     *
     * Separate from UI_LANGUAGE on purpose — the app chrome can be English
     * while the interview itself is conducted in a regional language.
     *
     * Validated against the central registry so an unsupported value is a
     * loud startup error rather than a silent fall back to English.
     */
    INTERVIEW_LANGUAGE: z
      .string()
      .default("english")
      .transform((v) => v.trim().toLowerCase())
      .refine(isTranslatedLanguageKey, {
        message: `must be one of: ${TRANSLATED_LANGUAGE_KEYS.join(", ")} (a language needs both Sarvam STT+TTS support and a UI translation)`,
      }),

    /**
     * Language of the APPLICATION UI: login, dashboard, setup form, buttons,
     * labels and the pre-interview instructions. Defaults to English.
     *
     * AI-generated content (questions, transcripts, evaluations, the report)
     * always follows the interview session language, never this.
     */
    UI_LANGUAGE: z
      .string()
      .default("english")
      .transform((v) => v.trim().toLowerCase())
      .refine(isTranslatedLanguageKey, {
        message: `must be one of: ${TRANSLATED_LANGUAGE_KEYS.join(", ")}`,
      }),

    // --- Sarvam (speech-to-text + text-to-speech + chat) ---
    SARVAM_API_KEY: z.string().min(1),
    SARVAM_STT_MODEL: z.string().min(1).default("saaras:v3"),
    /** Realtime streaming STT model used by the WebSocket relay. */
    SARVAM_STT_REALTIME_MODEL: z
      .string()
      .min(1)
      .default("saaras:v3-realtime"),
    SARVAM_TTS_MODEL: z.string().min(1).default("bulbul:v3"),
    SARVAM_TTS_SPEAKER: z.string().min(1).default("shubh"),
    /**
     * Live conversational turns: questions, follow-ups and re-asks. Chosen
     * for latency over depth — it sits on the candidate's critical path.
     */
    SARVAM_CHAT_MODEL: z.string().min(1).default("sarvam-105b-conversations"),
    /**
     * Scoring and the closing report, where nobody is waiting on the
     * response. A reasoning model, so it is slower but more considered.
     */
    SARVAM_ANALYSIS_MODEL: z.string().min(1).default("sarvam-105b"),

    // --- Cloudflare R2 (answer + question audio storage) ---
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
    CLOUDFLARE_R2_ENDPOINT: z.string().url(),
    /** Dedicated private bucket for interview recordings. */
    CLOUDFLARE_R2_BUCKET: z.string().min(1).default("ai-interview-recordings"),
    /** Key prefix inside the bucket, keeping app objects grouped. */
    CLOUDFLARE_R2_PREFIX: z.string().min(1).default("skill-passport"),
    /**
     * Optional and unused by the app. Interview audio is NEVER served from a
     * public bucket URL — recordings are private, and playback goes through
     * an authenticated route that issues a short-lived presigned URL.
     */
    CLOUDFLARE_R2_PUBLIC_URL: z.string().url().optional(),
  },

  client: {
    /**
     * Turns on realtime streaming STT (mic → relay → Sarvam). "1" to enable.
     * Off by default: the app falls back to the record-then-transcribe flow, so
     * it still works with no relay running. Enable once the relay is up and
     * `NEXT_PUBLIC_STT_RELAY_URL` is set.
     */
    NEXT_PUBLIC_STT_STREAMING: z.enum(["0", "1"]).default("0"),
    /**
     * WebSocket origin of the STT relay — e.g. `ws://localhost:3001` in dev,
     * `wss://your-host` in production (a `/stt-stream` route proxied to the
     * relay process). No trailing slash; the `/stt-stream` path is added by the
     * client.
     */
    NEXT_PUBLIC_STT_RELAY_URL: z
      .string()
      .optional()
      .transform((v) => v?.replace(/\/+$/, "")),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_STT_STREAMING: process.env.NEXT_PUBLIC_STT_STREAMING,
    NEXT_PUBLIC_STT_RELAY_URL: process.env.NEXT_PUBLIC_STT_RELAY_URL,
  },

  emptyStringAsUndefined: true,
  /**
   * CI and `next build` in Docker run without real secrets. Mirrors the
   * escape hatch the other ThreePointOLabs apps use.
   */
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.NEXT_BUILD === "1",
});
