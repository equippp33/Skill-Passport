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

/** All ten skills, in framework order, so nothing is silently omitted. */
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
