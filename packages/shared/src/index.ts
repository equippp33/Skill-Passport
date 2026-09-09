/**
 * Code shared by every app in the monorepo.
 *
 * Keep this package platform-agnostic: it is consumed by both the Next.js web
 * app (bundled via `transpilePackages`) and the Expo app (bundled by Metro),
 * so it must not import from `next`, `react-native`, or the DOM.
 */

export const APP_NAME = "Skill Passport";

export const SKILL_LEVELS = [
  "novice",
  "intermediate",
  "advanced",
  "expert",
] as const;

export type SkillLevel = (typeof SKILL_LEVELS)[number];

export interface Skill {
  id: string;
  name: string;
  level: SkillLevel;
}

/** Human-readable label for a skill level, e.g. "intermediate" -> "Intermediate". */
export function formatSkillLevel(level: SkillLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}
