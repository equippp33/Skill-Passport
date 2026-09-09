import type { TranslatedLanguageKey } from "../languages";
import { en } from "./en";
import type { Messages } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";

export type { Messages };

/**
 * Candidate-facing UI copy, one dictionary per language.
 *
 * Typed as `Record<TranslatedLanguageKey, Messages>`, so this fails to compile
 * if a key is added to `TRANSLATED_LANGUAGE_KEYS` without a dictionary — that
 * is what keeps the two lists honest.
 */
export const MESSAGES: Record<TranslatedLanguageKey, Messages> = {
  english: en,
  hindi: hi,
  marathi: mr,
};

export function getMessages(language: TranslatedLanguageKey): Messages {
  return MESSAGES[language];
}

/**
 * Substitute `{placeholders}`.
 *
 *   t(m.interview.questionProgress, { current: 2, total: 10 })
 *
 * Deliberately tiny — the alternative is an i18n runtime this app does not
 * need. Unknown placeholders are left untouched so a typo is visible rather
 * than silently blanking the string.
 */
export function t(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
