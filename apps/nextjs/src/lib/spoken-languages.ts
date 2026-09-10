import { INTERVIEW_LANGUAGES, languageFromCode } from "~/config/languages";

/**
 * Which languages a candidate actually spoke.
 *
 * The attempt carries one language — the one the interview is conducted in —
 * but every answer is transcribed with detection on, so the turns record
 * what was really used. Someone can open in Hindi, slip into Telugu for a
 * story and answer the next one in English, and that is worth showing: it is
 * a fact about the candidate, and it explains an otherwise puzzling
 * transcript.
 *
 * Ordered by how many answers were given in each, so the language they
 * mostly used leads. Ties keep the order they first appeared in.
 */

export interface SpokenLanguage {
  /** BCP-47 code as Sarvam reported it. */
  code: string;
  /** Native name where we know the language, otherwise the raw code. */
  label: string;
  /** How many answers were given in it. */
  turns: number;
}

/** Native name, or the code itself for anything outside our set. */
export function labelForCode(code: string): string {
  const key = languageFromCode(code);
  return key ? INTERVIEW_LANGUAGES[key].displayName : code;
}

/** Tally detected languages across a set of turns. */
export function spokenLanguages(
  turns: { detectedLanguageCode: string | null }[],
): SpokenLanguage[] {
  const counts = new Map<string, number>();

  for (const turn of turns) {
    const code = turn.detectedLanguageCode?.trim();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  // `Map` preserves insertion order, so a stable sort on the count alone
  // leaves equally-used languages in the order they were first heard.
  return [...counts.entries()]
    .map(([code, turnCount]) => ({
      code,
      label: labelForCode(code),
      turns: turnCount,
    }))
    .sort((a, b) => b.turns - a.turns);
}

/**
 * One line for a list row: "Hindi, English, Telugu".
 *
 * Falls back to the attempt's own language when nothing has been detected
 * yet, so a fresh attempt reads as pending rather than blank. That value is
 * a language KEY ("english"), not a code, which is why it is looked up
 * differently from the detected ones.
 */
export function formatSpokenLanguages(
  spoken: SpokenLanguage[],
  attemptLanguageKey: string | null,
): string {
  if (spoken.length > 0) return spoken.map((s) => s.label).join(", ");
  if (!attemptLanguageKey) return "language pending";

  const known =
    INTERVIEW_LANGUAGES[attemptLanguageKey as keyof typeof INTERVIEW_LANGUAGES];
  return known ? known.displayName : attemptLanguageKey;
}
