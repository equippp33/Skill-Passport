/**
 * Code shared by every app in the monorepo.
 *
 * Keep this package framework-agnostic: it is consumed by the Next.js app
 * via `transpilePackages` and should stay usable from a script, a worker or
 * a second app later, so it must not import from `next` or the DOM.
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
