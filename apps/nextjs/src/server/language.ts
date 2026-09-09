import "server-only";

import { resolveLanguage } from "~/config/languages";
import type {
  InterviewLanguage,
  TranslatedLanguageKey,
} from "~/config/languages";
import { getMessages } from "~/config/messages";
import type { Messages } from "~/config/messages";
import { env } from "~/env";

/**
 * Server-side language resolution.
 *
 * There are two independent languages, and mixing them up is the easy mistake:
 *
 *  - UI_LANGUAGE        → app chrome: login, dashboard, buttons, labels,
 *                         instructions. Use `uiMessages()`.
 *  - INTERVIEW_LANGUAGE → interview content: questions, Sarvam STT/TTS,
 *                         evaluation, feedback, the final report. Read from
 *                         the SESSION row, not from env, once an interview
 *                         exists — see `sessionLanguage()`.
 *
 * Rule of thumb: anything the model wrote, or the candidate said, is in the
 * session language. Everything the app wrote is in the UI language.
 *
 * Lives apart from `~/config/languages` because it reads `~/env`, and `env`
 * imports the registry to validate the keys — one file would be circular.
 *
 * Client Components cannot read `env`, so pages resolve here and pass the
 * resulting `Messages` object down as a prop.
 */

export type ResolvedLanguage = InterviewLanguage & {
  key: TranslatedLanguageKey;
};

/* ------------------------------- UI chrome -------------------------------- */

export function uiLanguage(): ResolvedLanguage {
  return resolveLanguage(env.UI_LANGUAGE);
}

export function uiMessages(): Messages {
  return getMessages(uiLanguage().key);
}

/* ---------------------------- Interview content --------------------------- */

/**
 * The language NEW interviews will be created in. Existing interviews keep
 * whatever was frozen onto their session row.
 */
export function configuredInterviewLanguage(): ResolvedLanguage {
  return resolveLanguage(env.INTERVIEW_LANGUAGE);
}

/** The language a specific interview was started in. */
export function sessionLanguage(languageKey: string): ResolvedLanguage {
  return resolveLanguage(languageKey);
}

/**
 * Dictionary in the INTERVIEW language.
 *
 * Only for strings that are interview content spoken to or read by the
 * candidate — the greeting, for example. Page chrome must use uiMessages().
 */
export function sessionMessages(languageKey: string): Messages {
  return getMessages(resolveLanguage(languageKey).key);
}
