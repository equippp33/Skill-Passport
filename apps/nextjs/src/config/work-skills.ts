/**
 * The interview framework: the general employability / workplace skills.
 *
 * This is a WORKPLACE-SKILLS assessment, not a technical screen. The prompts
 * built from this file explicitly forbid software-development and other
 * highly technical questions.
 *
 * Order is meaningful: turns are assigned to skills in this order, so every
 * interview covers all ten.
 */

import { WORK_READINESS_QUESTIONS } from "./work-readiness-pool";

export const WORK_SKILL_IDS = [
  "work_readiness",
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
  /**
   * Calm, everyday-life questions that work for someone with no job experience.
   * For `work_readiness` this is the FIXED bank the question is picked from
   * verbatim (never AI-generated). For the other skills these are STYLE ANCHORS
   * the model mimics — it writes a fresh question in the same spirit, never a
   * workplace/"your job" scenario. `customer_orientation` is the exception: it
   * is framed from the candidate's course, so it has no fixed anchors.
   */
  exampleQuestions: string[];
}

export const WORK_SKILLS: readonly WorkSkill[] = [
  {
    id: "work_readiness",
    label: "Work Readiness & Aspirations",
    definition:
      "A realistic picture of working life and clear goals — understanding what a job expects and what they want to get out of it.",
    scenarioFocus:
      "what they want from work and what being ready for a job means to them",
    // Work readiness is drawn from a FIXED per-language pool, not AI-generated
    // — see `work-readiness-pool.ts`. This English list mirrors it.
    exampleQuestions: WORK_READINESS_QUESTIONS.map((q) => q.en),
  },
  {
    id: "reliability",
    label: "Reliability",
    definition:
      "Turning up as agreed and finishing work by the time promised, without needing chasing.",
    scenarioFocus: "completing work on time and keeping commitments",
    exampleQuestions: [
      "What work do you do every day at home?",
      "How do you make sure you reach places on time?",
      "Tell me about a promise you made and kept.",
      "If you were going to be late somewhere, what would you do?",
      "How do you wake up on time every morning?",
    ],
  },
  {
    id: "responsibility",
    label: "Responsibility",
    definition:
      "Owning outcomes, admitting mistakes early, and putting them right rather than shifting blame.",
    scenarioFocus: "taking responsibility for a mistake at work",
    exampleQuestions: [
      "Tell me about a mistake you made. What did you do after that?",
      "Have you ever broken or lost something? What did you do?",
      "If you damaged something by mistake, what would you do?",
      "What responsibilities do you have in your family?",
      "Tell me about something someone trusted you to take care of.",
    ],
  },
  {
    id: "following_instructions",
    label: "Following Instructions",
    definition:
      "Understanding and following instructions, rules and processes correctly, and asking when unsure.",
    scenarioFocus: "following instructions and workplace processes exactly",
    exampleQuestions: [
      "When someone gives you a task with steps, how do you make sure you do it right?",
      "If you don't understand an instruction, what do you do?",
      "Tell me about a time you followed a recipe or a list exactly.",
      "If someone tells you to do it one way but you know an easier way, what will you do?",
      "How do you remember instructions someone gives you?",
      "Have you ever filled out a form? How did you make sure it was correct?",
    ],
  },
  {
    id: "attention_to_detail",
    label: "Attention to Detail",
    definition:
      "Noticing small but important details and catching errors before they cause problems.",
    scenarioFocus: "noticing an important detail others missed",
    exampleQuestions: [
      "When you buy something from a shop, what do you check before leaving?",
      "How do you check that you got the right change?",
      "Before leaving home, what do you check?",
      "If you were packing boxes, how would you make sure nothing is missing?",
      "Tell me about a time you noticed a small mistake that others missed.",
    ],
  },
  {
    id: "communication",
    label: "Communication",
    definition:
      "Explaining things clearly and listening properly, in person and in writing.",
    scenarioFocus: "communicating clearly with a colleague or supervisor",
    exampleQuestions: [
      "Explain to me, step by step, how to make tea.",
      "Tell me how to go from your house to the nearest bus stand.",
      "Tell me about yourself and your family.",
      "If you were feeling unwell, how would you tell someone?",
      "How would you explain a simple task to a new person?",
    ],
  },
  {
    id: "teamwork",
    label: "Teamwork",
    definition:
      "Cooperating with colleagues, sharing work fairly, and handling disagreement respectfully.",
    scenarioFocus: "cooperating with colleagues, including during disagreement",
    exampleQuestions: [
      "Tell me about a time you worked with others, like at a wedding or festival.",
      "What will you do if someone in your group is not doing their share?",
      "If you and a friend disagree, how will you sort it out?",
      "Have you ever helped someone finish their work?",
      "Do you like doing things alone or with others? Why?",
      "What do you do when a friend or family member is upset with you?",
    ],
  },
  {
    id: "problem_solving",
    label: "Problem Solving",
    definition:
      "Working out the cause of a practical problem and choosing a sensible way to fix it.",
    scenarioFocus: "solving an unexpected problem at work",
    exampleQuestions: [
      "Tell me about a time something suddenly went wrong. What did you do?",
      "If your bus doesn't come and you're getting late, what will you do?",
      "If a machine stops working while you're using it, what will you do?",
      "If you lost your phone or wallet, what would you do first?",
      "If you run out of something in the middle of a task, what will you do?",
    ],
  },
  {
    id: "learning_adaptability",
    label: "Adaptability",
    definition:
      "Learning new tasks quickly, accepting feedback, and adjusting when things change.",
    scenarioFocus: "learning from feedback or adapting to a change at work",
    exampleQuestions: [
      "If someone says you are doing a task the wrong way, what will you do?",
      "If your daily schedule changes suddenly, how will you manage?",
      "Tell me about a time you had to learn something new quickly.",
      "Have you ever moved to a new place? How did you adjust?",
      "If you're given a different task than the one you expected, what will you do?",
    ],
  },
  {
    id: "initiative",
    label: "Initiative",
    definition:
      "Spotting what needs doing and acting on it without waiting to be told.",
    scenarioFocus: "taking initiative without being asked",
    exampleQuestions: [
      "Tell me about something you did without anyone asking you.",
      "If you finish your work early, what will you do?",
      "If you see something dirty or out of place, what will you do?",
      "Have you ever learned something new on your own?",
      "Tell me about a time you helped someone without being asked.",
    ],
  },
  {
    id: "customer_orientation",
    label: "Customer Orientation",
    definition:
      "Treating customers with respect and patience, especially when they are unhappy.",
    scenarioFocus:
      "handling a customer respectfully, including a difficult one",
    // Framed from the candidate's course/field instead of a fixed bank.
    exampleQuestions: [],
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
 * follow-ups. With `questionCount` equal to the skill count each skill gets one; with
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
