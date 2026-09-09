/**
 * The interview framework: ten general employability / workplace skills.
 *
 * This is a WORKPLACE-SKILLS assessment, not a technical screen. The prompts
 * built from this file explicitly forbid software-development and other
 * highly technical questions.
 *
 * Order is meaningful: turns are assigned to skills in this order, so every
 * interview covers all ten.
 */

export const WORK_SKILL_IDS = [
  "reliability",
  "responsibility",
  "following_instructions",
  "attention_to_detail",
  "communication",
  "teamwork",
  "problem_solving",
  "learning_adaptability",
  "initiative",
  "customer_orientation",
] as const;

export type WorkSkillId = (typeof WORK_SKILL_IDS)[number];

export interface WorkSkill {
  id: WorkSkillId;
  /** English label, used in prompts and as the translation fallback. */
  label: string;
  /** What the interviewer is probing for. Goes into the prompt. */
  definition: string;
  /** Concrete situation the question should be built around. */
  scenarioFocus: string;
}

export const WORK_SKILLS: readonly WorkSkill[] = [
  {
    id: "reliability",
    label: "Reliability",
    definition:
      "Turning up as agreed and finishing work by the time promised, without needing chasing.",
    scenarioFocus: "completing work on time and keeping commitments",
  },
  {
    id: "responsibility",
    label: "Responsibility",
    definition:
      "Owning outcomes, admitting mistakes early, and putting them right rather than shifting blame.",
    scenarioFocus: "taking responsibility for a mistake at work",
  },
  {
    id: "following_instructions",
    label: "Following Instructions",
    definition:
      "Understanding and following instructions, rules and processes correctly, and asking when unsure.",
    scenarioFocus: "following instructions and workplace processes exactly",
  },
  {
    id: "attention_to_detail",
    label: "Attention to Detail",
    definition:
      "Noticing small but important details and catching errors before they cause problems.",
    scenarioFocus: "noticing an important detail others missed",
  },
  {
    id: "communication",
    label: "Communication",
    definition:
      "Explaining things clearly and listening properly, in person and in writing.",
    scenarioFocus: "communicating clearly with a colleague or supervisor",
  },
  {
    id: "teamwork",
    label: "Teamwork",
    definition:
      "Cooperating with colleagues, sharing work fairly, and handling disagreement respectfully.",
    scenarioFocus: "cooperating with colleagues, including during disagreement",
  },
  {
    id: "problem_solving",
    label: "Thinking and Problem Solving",
    definition:
      "Working out the cause of a practical problem and choosing a sensible way to fix it.",
    scenarioFocus: "solving an unexpected problem at work",
  },
  {
    id: "learning_adaptability",
    label: "Learning and Adaptability",
    definition:
      "Learning new tasks quickly, accepting feedback, and adjusting when things change.",
    scenarioFocus: "learning from feedback or adapting to a change at work",
  },
  {
    id: "initiative",
    label: "Initiative",
    definition:
      "Spotting what needs doing and acting on it without waiting to be told.",
    scenarioFocus: "taking initiative without being asked",
  },
  {
    id: "customer_orientation",
    label: "Customer Orientation",
    definition:
      "Treating customers with respect and patience, especially when they are unhappy.",
    scenarioFocus:
      "handling a customer respectfully, including a difficult one",
  },
];

export const WORK_SKILL_COUNT = WORK_SKILLS.length;

const SKILLS_BY_ID = new Map(WORK_SKILLS.map((s) => [s.id, s]));

export function getWorkSkill(id: WorkSkillId): WorkSkill {
  const skill = SKILLS_BY_ID.get(id);
  if (!skill) throw new Error(`Unknown work skill: ${id}`);
  return skill;
}

export function isWorkSkillId(value: string): value is WorkSkillId {
  return SKILLS_BY_ID.has(value as WorkSkillId);
}

/**
 * Which skill a given turn assesses.
 *
 * Turns are grouped so that consecutive turns on the same skill act as genuine
 * follow-ups. With `questionCount = 10` each skill gets one question; with
 * `20`, turns 1-2 cover skill 1, turns 3-4 cover skill 2, and so on.
 *
 * The mapping is computed server-side from the turn number, so the model can
 * never change which skill is being assessed.
 */
export function skillForTurn(
  turnNumber: number,
  questionCount: number,
): WorkSkill {
  const perSkill = Math.max(1, Math.round(questionCount / WORK_SKILL_COUNT));
  const index = Math.floor((turnNumber - 1) / perSkill);
  return WORK_SKILLS[Math.min(index, WORK_SKILL_COUNT - 1)]!;
}

/** True when this turn is a follow-up on the same skill as the previous turn. */
export function isFollowUpTurn(
  turnNumber: number,
  questionCount: number,
): boolean {
  if (turnNumber <= 1) return false;
  return (
    skillForTurn(turnNumber, questionCount).id ===
    skillForTurn(turnNumber - 1, questionCount).id
  );
}

/* -------------------------------------------------------------------------- */
/*                          Turn numbering per attempt                        */
/* -------------------------------------------------------------------------- */

/**
 * Turn 1 of every attempt is the language probe, so the skill questions run
 * from turn 2. Keeping the arithmetic here means no caller has to remember
 * the offset.
 */
export const LANGUAGE_PROBE_TURN = 1;

/** Total turns a candidate answers: the probe plus one question per skill. */
export function totalTurns(questionCount: number): number {
  return questionCount + 1;
}

/** The skill a turn assesses, or null for the language probe. */
export function skillForAttemptTurn(
  turnNumber: number,
  questionCount: number,
): WorkSkill | null {
  if (turnNumber <= LANGUAGE_PROBE_TURN) return null;
  return skillForTurn(turnNumber - LANGUAGE_PROBE_TURN, questionCount);
}

/** True when this turn follows up on the same skill as the previous one. */
export function isAttemptFollowUp(
  turnNumber: number,
  questionCount: number,
): boolean {
  if (turnNumber <= LANGUAGE_PROBE_TURN + 1) return false;
  return isFollowUpTurn(turnNumber - LANGUAGE_PROBE_TURN, questionCount);
}
