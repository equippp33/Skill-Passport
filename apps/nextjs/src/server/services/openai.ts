import "server-only";

import OpenAI from "openai";
import { z } from "zod";

import { env } from "~/env";
import type { WorkSkill } from "~/config/work-skills";
import { ProviderError, isRetryableStatus, withRetry } from "./errors";
import {
  contextBlock,
  frameworkBlock,
  historyBlock,
  interviewerRules,
  skillBlock,
  untrusted,
} from "./openai-prompts";
import type { InterviewContext, PriorTurn } from "./openai-prompts";

export type { InterviewContext, PriorTurn };

const OPENAI_TIMEOUT_MS = 60_000;

/**
 * Whether question generation is available.
 *
 * OPENAI_API_KEY is optional so the app can boot and be navigated without it.
 * Callers use this to warn ahead of time instead of letting an interview fail
 * halfway through.
 */
export function isOpenAIConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError({
      provider: "openai",
      message: "OPENAI_API_KEY is not set",
      userMessage:
        "AI interviews are not configured yet. Add OPENAI_API_KEY to the environment and try again.",
      // A missing key never fixes itself; retrying would just burn attempts.
      retryable: false,
    });
  }

  client ??= new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 0, // retries handled by withRetry so they stay classified
  });
  return client;
}

/* -------------------------------------------------------------------------- */
/*                              Response schemas                              */
/* -------------------------------------------------------------------------- */

export const turnEvaluationSchema = z.object({
  /** 0-10 for the single skill this turn assesses. */
  score: z.number().int().min(0).max(10),
  evaluation: z.string().min(1).max(1200),
  strengths: z.array(z.string().min(1).max(300)).max(4),
  improvements: z.array(z.string().min(1).max(300)).max(4),
  nextQuestion: z.string().max(600).nullable(),
  /** English rendering of `nextQuestion`; empty when already English. */
  questionTranslation: z.string().max(600),
  interviewComplete: z.boolean(),
});
export type TurnEvaluation = z.infer<typeof turnEvaluationSchema>;

export const interviewSummarySchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(1500),
  strengths: z.array(z.string().min(1).max(300)).max(6),
  improvements: z.array(z.string().min(1).max(300)).max(6),
});
export type InterviewSummary = z.infer<typeof interviewSummarySchema>;

/**
 * JSON Schemas are hand-written rather than derived from the zod schemas.
 * Structured Outputs requires `strict: true` with every property listed in
 * `required` and `additionalProperties: false`; keeping the wire schema
 * explicit avoids depending on zod-to-JSON-Schema helper behaviour across zod
 * versions. The zod schemas above still validate whatever comes back.
 */
const TURN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "score",
    "evaluation",
    "strengths",
    "improvements",
    "nextQuestion",
    "questionTranslation",
    "interviewComplete",
  ],
  properties: {
    score: {
      type: "integer",
      description: "0-10 for the named work skill only.",
    },
    evaluation: {
      type: "string",
      description:
        "Two or three sentences addressed to the candidate, in the interview language.",
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      description:
        "What the candidate did well in this answer, in the interview language.",
    },
    improvements: {
      type: "array",
      items: { type: "string" },
      description:
        "What would have made this answer stronger, in the interview language.",
    },
    nextQuestion: {
      type: ["string", "null"],
      description:
        "The next question, in the interview language, or null when the interview is complete.",
    },
    questionTranslation: {
      type: "string",
      description:
        "Plain English translation of nextQuestion. Empty string when the interview language is English or nextQuestion is null.",
    },
    interviewComplete: { type: "boolean" },
  },
} as const;

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "summary", "strengths", "improvements"],
  properties: {
    overallScore: { type: "integer" },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
  },
} as const;

/* -------------------------------------------------------------------------- */
/*                                  Requests                                  */
/* -------------------------------------------------------------------------- */

function wrapOpenAIError(error: unknown): never {
  // Already classified (e.g. the missing-API-key guard) — keep its message.
  if (error instanceof ProviderError) throw error;

  const status =
    error instanceof OpenAI.APIError ? (error.status ?? 500) : undefined;

  if (status === 401 || status === 403) {
    throw new ProviderError({
      provider: "openai",
      message: "openai authentication failed",
      userMessage:
        "The interview service rejected our credentials. Please contact support.",
      retryable: false,
      status,
    });
  }

  console.error(
    `[openai] request failed status=${status ?? "unknown"} name=${
      error instanceof Error ? error.name : typeof error
    }`,
  );

  throw new ProviderError({
    provider: "openai",
    message: `openai request failed (status ${status ?? "unknown"})`,
    userMessage:
      "The interview service is temporarily unavailable. Please try again.",
    retryable: status === undefined ? true : isRetryableStatus(status),
    status,
  });
}

async function requestStructured<T>(args: {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
}): Promise<T> {
  const run = async (): Promise<T> => {
    let raw: string;
    try {
      const response = await getClient().responses.create({
        model: env.OPENAI_MODEL,
        instructions: args.instructions,
        input: args.input,
        text: {
          format: {
            type: "json_schema",
            name: args.schemaName,
            strict: true,
            schema: args.jsonSchema,
          },
        },
      });
      raw = response.output_text;
    } catch (error) {
      wrapOpenAIError(error);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProviderError({
        provider: "openai",
        message: "openai returned non-JSON output",
        userMessage:
          "We could not read the interviewer response. Please try again.",
        retryable: true,
      });
    }

    const result = args.validator.safeParse(parsed);
    if (!result.success) {
      console.error(
        `[openai] structured response failed validation: ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.code}`)
          .join("; ")}`,
      );
      throw new ProviderError({
        provider: "openai",
        message: "openai response failed schema validation",
        userMessage:
          "We could not read the interviewer response. Please try again.",
        retryable: true,
      });
    }
    return result.data;
  };

  return withRetry(run, { attempts: 2 });
}

/* -------------------------------------------------------------------------- */
/*                                  Questions                                 */
/* -------------------------------------------------------------------------- */

/** Opening question, assessing the first skill in the framework. */
export interface GeneratedQuestion {
  question: string;
  /** English rendering, or null when the interview is already in English. */
  translation: string | null;
}

/**
 * Generate a fresh question for a given skill and turn, WITHOUT needing the
 * previous answer.
 *
 * This is what makes look-ahead possible: because a non-follow-up question
 * only depends on the skill, the framework and the questions already asked
 * (to avoid repeats), it can be prepared before the candidate has answered the
 * question in front of them. `history` is passed so the model does not repeat
 * itself; it is allowed to be empty for the opening question.
 */
export async function generateQuestion(args: {
  ctx: InterviewContext;
  skill: WorkSkill;
  /** 1-based skill-question number (the language probe is not counted). */
  turnNumber: number;
  history: PriorTurn[];
}): Promise<GeneratedQuestion> {
  const { ctx, skill, turnNumber, history } = args;
  const isFirst = turnNumber <= 1;

  const result = await requestStructured({
    instructions: interviewerRules(ctx),
    input: [
      contextBlock(ctx),
      "",
      frameworkBlock(),
      ...(history.length > 0
        ? ["", "## Questions already asked (never repeat these)", historyBlock(history)]
        : []),
      "",
      skillBlock(skill),
      "",
      isFirst
        ? `This is the START of the interview and question 1 of ${ctx.questionCount}.`
        : `This is question ${turnNumber} of ${ctx.questionCount}. It moves on to a new skill.`,
      `Produce the question, written in ${ctx.language.promptName}.`,
      `Set score to 0, evaluation to a single neutral word, strengths and`,
      `improvements to empty arrays, interviewComplete to false, put the`,
      `question in nextQuestion and its English translation in`,
      `questionTranslation.`,
    ].join("\n"),
    schemaName: "interview_turn",
    jsonSchema: TURN_JSON_SCHEMA,
    validator: turnEvaluationSchema,
  });

  const question = result.nextQuestion?.trim();
  if (!question) {
    throw new ProviderError({
      provider: "openai",
      message: "openai returned no question",
      userMessage: "We could not prepare the next question. Please try again.",
      retryable: true,
    });
  }
  return { question, translation: normaliseTranslation(ctx, result) };
}

/** Opening question, assessing the first skill in the framework. */
export async function generateFirstQuestion(
  ctx: InterviewContext,
  skill: WorkSkill,
): Promise<GeneratedQuestion> {
  return generateQuestion({ ctx, skill, turnNumber: 1, history: [] });
}

/**
 * A translation is only meaningful when the interview is not in English, and
 * the model sometimes echoes the question instead of leaving it blank.
 */
function normaliseTranslation(
  ctx: InterviewContext,
  result: TurnEvaluation,
): string | null {
  if (ctx.language.promptName === "English") return null;
  const translated = result.questionTranslation.trim();
  if (!translated) return null;
  return translated === result.nextQuestion?.trim() ? null : translated;
}

/**
 * Evaluate the latest answer against its skill, and produce the next question.
 *
 * The caller decides which skill each turn assesses; the model is told, never
 * asked. That keeps framework coverage deterministic.
 */
export async function evaluateAnswerAndGetNextQuestion(args: {
  ctx: InterviewContext;
  history: PriorTurn[];
  currentSkill: WorkSkill;
  currentQuestion: string;
  answerTranscript: string;
  turnNumber: number;
  /** Skill for the upcoming question, or null when this is the last turn. */
  nextSkill: WorkSkill | null;
  nextIsFollowUp: boolean;
}): Promise<TurnEvaluation> {
  const {
    ctx,
    history,
    currentSkill,
    currentQuestion,
    answerTranscript,
    turnNumber,
    nextSkill,
    nextIsFollowUp,
  } = args;

  const isFinalTurn = turnNumber >= ctx.questionCount || nextSkill === null;

  const nextInstruction = isFinalTurn
    ? [
        `This was the FINAL question. Set interviewComplete to true and`,
        `nextQuestion to null.`,
      ].join("\n")
    : [
        `Now produce question ${turnNumber + 1} of ${ctx.questionCount}.`,
        `That question must assess: ${nextSkill!.label} — ${nextSkill!.definition}`,
        `Build it around this situation: ${nextSkill!.scenarioFocus}.`,
        nextIsFollowUp
          ? `It is a FOLLOW-UP on the same skill: refer to something specific the candidate just said and probe deeper.`
          : `It moves on to a new skill.`,
        `Write it in ${ctx.language.promptName}. Set interviewComplete to false.`,
      ].join("\n");

  const evaluation = await requestStructured({
    instructions: interviewerRules(ctx),
    input: [
      contextBlock(ctx),
      "",
      frameworkBlock(),
      "",
      "## Questions already asked (never repeat these)",
      historyBlock(history),
      "",
      skillBlock(currentSkill),
      "",
      `This is question ${turnNumber} of ${ctx.questionCount}.`,
      `Question asked: ${currentQuestion}`,
      `Candidate answer (in ${ctx.language.promptName}, keep it in that language): ${untrusted(
        "ANSWER",
        answerTranscript,
      )}`,
      "",
      `Score this answer for ${currentSkill.label} only.`,
      nextInstruction,
    ].join("\n"),
    schemaName: "interview_turn",
    jsonSchema: TURN_JSON_SCHEMA,
    validator: turnEvaluationSchema,
  });

  // The question budget and completion are enforced server-side: never let the
  // model overrun the configured count or end the interview early.
  if (isFinalTurn) {
    return {
      ...evaluation,
      interviewComplete: true,
      nextQuestion: null,
      questionTranslation: "",
    };
  }
  if (!evaluation.nextQuestion?.trim()) {
    throw new ProviderError({
      provider: "openai",
      message: "openai returned no next question before the final turn",
      userMessage:
        "We could not generate the next question. Please retry this answer.",
      retryable: true,
    });
  }
  return { ...evaluation, interviewComplete: false };
}

/** Final report shown on the result page, in the interview language. */
export async function generateInterviewSummary(args: {
  ctx: InterviewContext;
  history: PriorTurn[];
  skillScores: { skillLabel: string; score: number | null }[];
}): Promise<InterviewSummary> {
  return requestStructured({
    instructions: [
      interviewerRules(args.ctx),
      "",
      `## Closing report`,
      `Write the candidate's closing report in ${args.ctx.language.promptName}.`,
      `Be specific and constructive, and refer to what they actually said.`,
      `Do not state a hiring decision. overallScore is 0-100 across all skills.`,
    ].join("\n"),
    input: [
      contextBlock(args.ctx),
      "",
      "## Full interview transcript",
      historyBlock(args.history),
      "",
      "## Scores already given, per skill (out of 10)",
      args.skillScores
        .map(
          (s) =>
            `- ${s.skillLabel}: ${s.score === null ? "not assessed" : s.score}`,
        )
        .join("\n"),
      "",
      `Produce the overall score, a short summary, the candidate's strongest`,
      `areas and the areas to improve — all in ${args.ctx.language.promptName}.`,
    ].join("\n"),
    schemaName: "interview_summary",
    jsonSchema: SUMMARY_JSON_SCHEMA,
    validator: interviewSummarySchema,
  });
}

/* -------------------------------------------------------------------------- */
/*                                Re-asking                                   */
/* -------------------------------------------------------------------------- */

const TRANSLATED_QUESTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["question", "questionTranslation"],
  properties: {
    question: {
      type: "string",
      description: "The same question, written in the target language.",
    },
    questionTranslation: {
      type: "string",
      description: "English rendering, or an empty string if already English.",
    },
  },
};

const translatedQuestionSchema = z.object({
  question: z.string(),
  questionTranslation: z.string(),
});

/**
 * Say the same question again in a different language.
 *
 * Used when a candidate switches language part-way through: the question
 * they are looking at should change language, not change. Generating a fresh
 * question instead would move the goalposts mid-answer, and would quietly
 * break the one-skill-per-turn mapping the report depends on.
 */
export async function translateQuestion(
  ctx: InterviewContext,
  question: string,
): Promise<GeneratedQuestion> {
  const result = await requestStructured({
    instructions: [
      "You translate interview questions between languages.",
      "Preserve the meaning, the tone and the scenario exactly.",
      "Do not answer it, shorten it, or ask anything different.",
      "Return only the translation.",
    ].join(" "),
    input: [
      `Target language: ${ctx.language.promptName}.`,
      "",
      "Question to translate:",
      untrusted("QUESTION", question),
      "",
      `Put the ${ctx.language.promptName} version in "question".`,
      ctx.language.promptName === "English"
        ? 'Leave "questionTranslation" as an empty string.'
        : 'Put a plain English rendering in "questionTranslation".',
    ].join("\n"),
    schemaName: "translated_question",
    jsonSchema: TRANSLATED_QUESTION_JSON_SCHEMA,
    validator: translatedQuestionSchema,
  });

  const translated = result.question.trim();
  if (!translated) {
    throw new ProviderError({
      provider: "openai",
      message: "openai returned an empty translation",
      userMessage: "We could not switch the language. Please try again.",
      retryable: true,
    });
  }

  const english = result.questionTranslation.trim();
  return {
    question: translated,
    translation:
      ctx.language.promptName === "English" || english === translated
        ? null
        : english || null,
  };
}
