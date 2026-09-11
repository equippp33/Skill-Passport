/**
 * Central interview-language configuration.
 *
 * This is the ONLY place language names and BCP-47 codes are declared. Nothing
 * elsewhere in the app may hardcode a language — everything resolves through
 * `resolveLanguage()` and the session's stored language key.
 *
 * Supported set = languages supported by BOTH configured Sarvam models:
 *   - STT (saaras:v3/v4) supports 24 codes.
 *   - TTS (bulbul:v2/v3) supports 11: bn, en, gu, hi, kn, ml, mr, od, pa, ta, te.
 * The intersection is therefore the 11 TTS languages listed below. A language
 * the interviewer cannot speak is not usable, so STT-only languages
 * (as-IN, ur-IN, ne-IN, …) are deliberately excluded.
 *
 * A language additionally needs a UI dictionary (`./messages`) before it can
 * be selected — see `AVAILABLE_INTERVIEW_LANGUAGES`.
 */

export interface InterviewLanguage {
  /** BCP-47 code sent to Sarvam STT and TTS. */
  code: string;
  /** Native name, shown to candidates. */
  displayName: string;
  /** English name, used inside OpenAI prompts. */
  promptName: string;
  /**
   * One or two glyphs from the language's own script, used as its mark in
   * the picker. A script glyph rather than a flag: several of these share a
   * country, and a flag would be the wrong thing to identify a language by.
   */
  symbol: string;
  /**
   * Sarvam TTS speaker. Voices are language-agnostic in bulbul:v3, but this
   * allows per-language tuning without touching the service layer.
   */
  speaker?: string;
  /**
   * A short spoken thank-you the interviewer says the moment the candidate
   * finishes an answer. Deliberately just gratitude — it never mentions the
   * recording, the next question, or anything procedural. In the interview
   * language, because it is the interviewer speaking.
   */
  acknowledgement: string;
}

/** Every language both Sarvam models can handle. */
export const INTERVIEW_LANGUAGES = {
  english: {
    code: "en-IN",
    displayName: "English",
    promptName: "English",
    symbol: "Aa",
    acknowledgement: "Thank you for answering.",
  },
  hindi: {
    code: "hi-IN",
    displayName: "हिंदी",
    promptName: "Hindi",
    symbol: "हि",
    acknowledgement: "जवाब देने के लिए धन्यवाद।",
  },
  marathi: {
    code: "mr-IN",
    displayName: "मराठी",
    promptName: "Marathi",
    symbol: "म",
    acknowledgement: "उत्तर दिल्याबद्दल धन्यवाद.",
  },
  bengali: {
    code: "bn-IN",
    displayName: "বাংলা",
    promptName: "Bengali",
    symbol: "বা",
    acknowledgement: "উত্তর দেওয়ার জন্য ধন্যবাদ।",
  },
  gujarati: {
    code: "gu-IN",
    displayName: "ગુજરાતી",
    promptName: "Gujarati",
    symbol: "ગુ",
    acknowledgement: "જવાબ આપવા બદલ આભાર.",
  },
  kannada: {
    code: "kn-IN",
    displayName: "ಕನ್ನಡ",
    promptName: "Kannada",
    symbol: "ಕ",
    acknowledgement: "ಉತ್ತರಿಸಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು.",
  },
  malayalam: {
    code: "ml-IN",
    displayName: "മലയാളം",
    promptName: "Malayalam",
    symbol: "മ",
    acknowledgement: "ഉത്തരം നൽകിയതിന് നന്ദി.",
  },
  odia: {
    code: "od-IN",
    displayName: "ଓଡ଼ିଆ",
    promptName: "Odia",
    symbol: "ଓ",
    acknowledgement: "ଉତ୍ତର ଦେଇଥିବାରୁ ଧନ୍ୟବାଦ।",
  },
  punjabi: {
    code: "pa-IN",
    displayName: "ਪੰਜਾਬੀ",
    promptName: "Punjabi",
    symbol: "ਪੰ",
    acknowledgement: "ਜਵਾਬ ਦੇਣ ਲਈ ਧੰਨਵਾਦ।",
  },
  tamil: {
    code: "ta-IN",
    displayName: "தமிழ்",
    promptName: "Tamil",
    symbol: "த",
    acknowledgement: "பதிலளித்ததற்கு நன்றி.",
  },
  telugu: {
    code: "te-IN",
    displayName: "తెలుగు",
    promptName: "Telugu",
    symbol: "తె",
    acknowledgement: "సమాధానం ఇచ్చినందుకు ధన్యవాదాలు.",
  },
} as const satisfies Record<string, InterviewLanguage>;

export type InterviewLanguageKey = keyof typeof INTERVIEW_LANGUAGES;

export const INTERVIEW_LANGUAGE_KEYS = Object.keys(
  INTERVIEW_LANGUAGES,
) as InterviewLanguageKey[];

/**
 * Languages that also have a candidate-facing UI dictionary.
 *
 * Adding a language is a two-step job: it must appear above (Sarvam support)
 * AND have a dictionary in `./messages`. Keep this list in sync with the
 * `MESSAGES` record — `messages/index.ts` asserts they match at build time.
 */
export const TRANSLATED_LANGUAGE_KEYS = [
  "english",
  "hindi",
  "marathi",
] as const satisfies readonly InterviewLanguageKey[];

export type TranslatedLanguageKey = (typeof TRANSLATED_LANGUAGE_KEYS)[number];

/** What a language selector should offer today. */
export const AVAILABLE_INTERVIEW_LANGUAGES = TRANSLATED_LANGUAGE_KEYS.map(
  (key) => ({ key, ...INTERVIEW_LANGUAGES[key] }),
);

/**
 * Reverse lookup by BCP-47 code, for turning what Sarvam detected back into
 * one of our languages.
 */
const BY_CODE = new Map(
  INTERVIEW_LANGUAGE_KEYS.map((key) => [
    INTERVIEW_LANGUAGES[key].code.toLowerCase(),
    key,
  ]),
);

/**
 * Resolve a language Sarvam reported.
 *
 * Returns null rather than throwing for anything we cannot run — an STT-only
 * language, or a code we do not know. The caller then asks the candidate to
 * choose instead of guessing.
 */
export function languageFromCode(
  code: string | null | undefined,
): InterviewLanguageKey | null {
  if (!code) return null;
  return BY_CODE.get(code.trim().toLowerCase()) ?? null;
}

/**
 * Resolve a language for INTERVIEW CONTENT.
 *
 * Wider than resolveLanguage(): the interview itself only needs Sarvam STT +
 * TTS, so all 11 are allowed. A UI dictionary is only required for app
 * chrome, which stays in UI_LANGUAGE.
 */
export function resolveInterviewLanguage(
  key: string,
): InterviewLanguage & { key: InterviewLanguageKey } {
  const normalised = key.trim().toLowerCase() as InterviewLanguageKey;
  const found = INTERVIEW_LANGUAGES[normalised];
  if (!found) {
    throw new LanguageConfigurationError(
      `"${key}" is not a supported interview language. Supported: ${INTERVIEW_LANGUAGE_KEYS.join(", ")}.`,
    );
  }
  return { key: normalised, ...found };
}

/** Everything a candidate may be offered when detection fails. */
export const SELECTABLE_INTERVIEW_LANGUAGES = INTERVIEW_LANGUAGE_KEYS.map(
  (key) => ({ key, ...INTERVIEW_LANGUAGES[key] }),
);

/** Below this, treat Sarvam's guess as unusable and ask the candidate. */
export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.6;

export class LanguageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageConfigurationError";
  }
}

export function isTranslatedLanguageKey(
  value: string,
): value is TranslatedLanguageKey {
  return (TRANSLATED_LANGUAGE_KEYS as readonly string[]).includes(value);
}

/**
 * Resolve a language key to its configuration.
 *
 * Throws rather than falling back: a misconfigured language must be a loud
 * failure, never an interview silently conducted in the wrong language.
 */
export function resolveLanguage(
  key: string,
): InterviewLanguage & { key: TranslatedLanguageKey } {
  const normalised = key.trim().toLowerCase();

  if (!isTranslatedLanguageKey(normalised)) {
    const knownToSarvam = (
      INTERVIEW_LANGUAGE_KEYS as readonly string[]
    ).includes(normalised);

    throw new LanguageConfigurationError(
      knownToSarvam
        ? `INTERVIEW_LANGUAGE="${key}" is supported by Sarvam but has no UI translation yet. ` +
            `Add a dictionary in src/config/messages/ and list it in TRANSLATED_LANGUAGE_KEYS. ` +
            `Currently available: ${TRANSLATED_LANGUAGE_KEYS.join(", ")}.`
        : `INTERVIEW_LANGUAGE="${key}" is not a supported interview language. ` +
            `Supported by Sarvam STT + TTS: ${INTERVIEW_LANGUAGE_KEYS.join(", ")}. ` +
            `Currently available (with UI translations): ${TRANSLATED_LANGUAGE_KEYS.join(", ")}.`,
    );
  }

  return { key: normalised, ...INTERVIEW_LANGUAGES[normalised] };
}
