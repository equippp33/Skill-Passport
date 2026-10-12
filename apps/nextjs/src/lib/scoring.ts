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

/**
 * How good a passing sighting must be to count as corroboration.
 *
 * Measured on real answers: a skill that merely surfaced inside someone else's
 * answer scores consistently LOWER than the same skill asked about head-on,
 * because the candidate was busy answering something else and only showed it
 * incidentally. Averaging those lower numbers in would drag good scores down,
 * and taking the higher of the two would mean the sighting almost never
 * mattered. Neither is what a second piece of evidence is worth.
 *
 * So a sighting is not treated as a competing measurement at all. It is
 * CORROBORATION: proof the candidate showed the skill somewhere other than the
 * question built to test it. What matters is that it happened, not what it
 * scored — above the bar where it counts as evidence rather than a passing
 * mention.
 */
const CORROBORATION_THRESHOLD = 6;

/** What one corroborating answer is worth, and the most they can add together. */
const BONUS_PER_SIGHTING = 0.5;
const MAX_BONUS = 1;

/** Sightings needed before they can score a skill no question ever reached. */
const MIN_SIGHTINGS_TO_STAND_ALONE = 2;

/**
 * All skills, in framework order, so nothing is silently omitted.
 *
 * A skill's score comes from the questions that asked about it AND from other
 * answers that happened to demonstrate it. People do not answer one skill at a
 * time: a candidate asked what being ready for work means who replies "I take
 * responsibility for delivering quality results on time" has just evidenced
 * Responsibility, and before this that evidence was discarded — every skill
 * was judged solely from the one question aimed at it.
 *
 * Corroboration can only RAISE a score, never lower it. Showing a skill twice
 * is a reason to be more confident in a candidate; showing it weakly while
 * answering about something else is not a reason to doubt the answer they gave
 * to the question that actually asked.
 */
export function aggregateSkillScores(turns: InterviewTurn[]): SkillScore[] {
  const completed = turns.filter((t) => t.status === "completed");

  // Every sighting, gathered once and grouped by the skill it is evidence
  // FOR — not by the turn it was found in.
  const sightings = new Map<string, number[]>();
  for (const turn of completed) {
    for (const seen of turn.secondarySkills ?? []) {
      if (typeof seen?.score !== "number") continue;
      const list = sightings.get(seen.skillId) ?? [];
      list.push(seen.score);
      sightings.set(seen.skillId, list);
    }
  }

  return WORK_SKILLS.map((skill) => {
    const forSkill = turns.filter((t) => t.skillId === skill.id);
    const direct = completed
      .filter((t) => t.skillId === skill.id && t.score !== null)
      .map((t) => t.score!);
    const corroborating = (sightings.get(skill.id) ?? []).filter(
      (v) => v >= CORROBORATION_THRESHOLD,
    );

    return {
      skillId: skill.id,
      score: blend(direct, corroborating),
      turnNumbers: forSkill.map((t) => t.turnNumber),
    };
  });
}

/**
 * One skill's score from its own answers, plus corroboration from elsewhere.
 *
 * With no direct answer at all, sightings can stand in — but only from two or
 * more. A skill the interview never reached is better reported as "not
 * assessed" than conjured from a single stray remark, and an abandoned
 * interview is exactly where single remarks are all there is.
 */
function blend(direct: number[], corroborating: number[]): number | null {
  if (direct.length === 0) {
    if (corroborating.length < MIN_SIGHTINGS_TO_STAND_ALONE) return null;
    return Math.round(mean(corroborating));
  }
  const bonus = Math.min(MAX_BONUS, corroborating.length * BONUS_PER_SIGHTING);
  return Math.round(Math.min(10, mean(direct) + bonus));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
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
