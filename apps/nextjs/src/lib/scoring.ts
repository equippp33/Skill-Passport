import { WORK_SKILLS } from "~/config/work-skills";
import type { WorkSkillId } from "~/config/work-skills";
import type { InterviewTurn } from "~/server/db/schema";

/**
 * Skill aggregation.
 *
 * A pure function of the turns, with no database or environment access, so
 * it deliberately does NOT live in `~/server/attempt/service` — that module
 * is `server-only`, and the report renders in the browser too. Importing the
 * type from the schema is safe: `import type` is erased at compile time.
 */

export interface SkillScore {
  skillId: WorkSkillId;
  score: number | null;
  turnNumbers: number[];
}

/** All skills, in framework order, so nothing is silently omitted. */
export function aggregateSkillScores(turns: InterviewTurn[]): SkillScore[] {
  return WORK_SKILLS.map((skill) => {
    const forSkill = turns.filter((t) => t.skillId === skill.id);
    const scored = forSkill.filter(
      (t) => t.status === "completed" && t.score !== null,
    );
    return {
      skillId: skill.id,
      score:
        scored.length === 0
          ? null
          : Math.round(
              scored.reduce((sum, t) => sum + (t.score ?? 0), 0) /
                scored.length,
            ),
      turnNumbers: forSkill.map((t) => t.turnNumber),
    };
  });
}

/**
 * The uplift added to a model score before it is stored.
 *
 * Arithmetic, not persuasion. The alternative was to describe the scale
 * differently in the prompt and measure what came back, which landed on +0.8
 * one day and +0.9 the next and could not be aimed: a model cannot be asked
 * for "exactly one more point". This can, so the client's "raise it by one"
 * is implemented as raising it by one.
 *
 * This is now the ONLY thing moving scores. The rubric is back to what it
 * was, deliberately — running both at once stacked a fuzzy +0.9 on top of an
 * exact +1 and pushed good answers to a flat 10.
 *
 * Applied once, on the way INTO the database, so every reader agrees: the
 * question card, the skill bars, the overall, the retake comparison, the PDF
 * and the partner webhook all see the same number.
 *
 * The overall needs no rule of its own. It is `mean(skill scores) x 10`, so
 * lifting each question by one lifts the total by ten: 70 becomes 80 because
 * 7 became 8.
 */
export const SCORE_UPLIFT = 1;

/**
 * Below this, nothing is added.
 *
 * 0-2 is "did not answer the question, off-topic, or a refusal" and 3-4 is
 * "barely engages". A candidate who said nothing usable must not be handed a
 * pass mark: the report is used to place people, and inflating the bottom
 * costs the client far more than a harsh top ever did.
 */
export const SCORE_UPLIFT_FLOOR = 5;

/** A stored score from a model score. Pure, so it is one line to remove. */
export function adjustScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const clamped = Math.min(10, Math.max(0, Math.round(raw)));
  return clamped < SCORE_UPLIFT_FLOOR
    ? clamped
    : Math.min(10, clamped + SCORE_UPLIFT);
}
