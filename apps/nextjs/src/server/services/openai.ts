import "server-only";

import OpenAI from "openai";
import { z } from "zod";

import { env } from "~/env";
import type { WorkSkill, WorkSkillId } from "~/config/work-skills";
import { ProviderError, isRetryableStatus, withRetry } from "./errors";
import { timed } from "./timing";
import { recordUsage } from "~/server/interview/usage";
import { requestStructuredViaSarvam } from "./sarvam-chat";
import type { SarvamChatKind } from "./sarvam-chat";
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

// Short on purpose — see the matching note in sarvam.ts. A structured JSON
// response for one short question/evaluation normally returns in a few
// seconds; 20s already covers a genuinely slow one without letting a stuck
// request sit on the critical path for a minute-plus.
const OPENAI_TIMEOUT_MS = 20_000;

/**
 * Sarvam circuit breaker.
 *
 * When a Sarvam chat call fails (its API degrades — 130s+ and non-JSON on a
 * bad day), we stop routing to it until this timestamp and go straight to
 * OpenAI, so a candidate never eats the timeout more than once per outage. A
 * later Sarvam success clears it. Module-level, so it is shared across requests
 * in one server process; a fresh process simply re-learns on its first call.
 *
 * ponytail: one shared timestamp, no per-key breaker or half-open probing —
 * add those only if one flaky model shouldn't sideline the other.
 */
const SARVAM_BREAKER_COOLDOWN_MS = 3 * 60_000;
let sarvamOpenUntil = 0;

/**
 * Whether question generation is available.
 *
 * Reports on whichever provider `AI_PROVIDER` selects, not on OpenAI
 * specifically — otherwise a Sarvam-powered interview would be refused for a
 * missing OPENAI_API_KEY it never uses. SARVAM_API_KEY is required at boot,
 * so under Sarvam this is always true; OPENAI_API_KEY stays optional so the
 * app can boot and be navigated without it.
 *
 * Callers use this to warn ahead of time instead of letting an interview fail
 * halfway through. The name is kept so call sites need no change when the
 * provider is switched back.
 */
export function isOpenAIConfigured(): boolean {
  if (env.AI_PROVIDER === "sarvam") return Boolean(env.SARVAM_API_KEY);
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
  /**
   * Whether this was an attempt at the question at all.
   *
   * Asked of the model that is already scoring the turn, so it costs no extra
   * call and no extra wait. A word list cannot cover abuse across eleven
   * languages; this can, and it is only ever a flag for a human reviewer.
   *
   * Optional rather than defaulted: a default would make zod's input and
   * output types diverge, and every place that rebuilds one of these by
   * spreading would stop type-checking. Absent means `none`, applied where it
   * is stored.
   */
  concern: z.enum(["none", "off_topic", "inappropriate"]).optional(),
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
    "concern",
  ],
  properties: {
    score: {
      type: "integer",
      description: "0-10 for the named work skill only.",
    },
    // These three are the REVIEWER's notes and must be ENGLISH, matching the
    // Language section of `interviewerRules`. They previously read "in the
    // interview language", which contradicted it: harmless while only OpenAI
    // ran (it followed the instructions and ignored the descriptions), but
    // Sarvam is given the field descriptions as part of its prompt and
    // followed them instead, returning Telugu evaluations into the admin
    // report. One wording, one source of truth, both providers agree.
    evaluation: {
      type: "string",
      description:
        "Two or three sentences addressed to the candidate, in ENGLISH.",
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "What the candidate did well in this answer, in ENGLISH.",
    },
    improvements: {
      type: "array",
      items: { type: "string" },
      description: "What would have made this answer stronger, in ENGLISH.",
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
    concern: {
      type: "string",
      enum: ["none", "off_topic", "inappropriate"],
      description:
        "none for any genuine attempt at the question, however weak or brief. off_topic when the candidate chatted, asked the interviewer something, or talked about something unrelated. inappropriate for abuse, threats or sexual content. Default to none when unsure.",
    },
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

/**
 * The single seam between the interview logic and whichever model runs it.
 *
 * Every prompt in this file goes through here, so swapping the AI provider is
 * this one dispatch and nothing else — the prompts, schemas, zod validators,
 * error handling and all six public functions below are provider-agnostic and
 * shared.
 *
 * `AI_PROVIDER` currently defaults to "sarvam". The OpenAI branch is intact
 * and exercised by setting `AI_PROVIDER=openai`; nothing about it was
 * removed.
 */
async function requestStructured<T>(args: {
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  /**
   * Which class of model should answer.
   *
   * "conversation" is on the candidate's critical path and is optimised for
   * latency; "analysis" is scoring and reporting, where nobody is waiting.
   * The OpenAI path ignores this — it uses one model for both.
   */
  kind: SarvamChatKind;
}): Promise<T> {
  const label = `llm.${env.AI_PROVIDER}.${args.kind}.${args.schemaName}`;
  // Prompt size printed alongside the time: a huge payload would slow BOTH
  // providers, which is a different problem from one provider being slow.
  const detail = () =>
    `prompt=${args.instructions.length + args.input.length}chars`;

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
      // Exact counts from the provider rather than an estimate from the
      // prompt length: reasoning and cached tokens are billed differently and
      // only the response knows the real figures.
      recordUsage({
        llmRequests: 1,
        llmInputTokens: response.usage?.input_tokens ?? 0,
        llmOutputTokens: response.usage?.output_tokens ?? 0,
      });
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

  const openaiFallback = () =>
    timed(
      `llm.openai-fallback.${args.kind}.${args.schemaName}`,
      () => withRetry(run, { attempts: 2 }),
      detail,
    );

  // Sarvam selected: try it, but never let a degraded Sarvam strand the
  // candidate. The circuit breaker means an outage costs ONE timeout, not one
  // per question: the first failure opens the breaker and every call for the
  // next few minutes skips Sarvam entirely and goes straight to OpenAI. A
  // Sarvam success closes it again. Language quality is Sarvam's when healthy,
  // availability is OpenAI's when it is not.
  if (env.AI_PROVIDER === "sarvam") {
    // Breaker open and OpenAI available: don't even probe Sarvam — no wait.
    if (sarvamOpenUntil > Date.now() && env.OPENAI_API_KEY) {
      return openaiFallback();
    }
    try {
      const result = await timed(
        label,
        () => requestStructuredViaSarvam(args),
        detail,
      );
      sarvamOpenUntil = 0; // healthy — close the breaker
      return result;
    } catch (error) {
      if (!env.OPENAI_API_KEY) throw error;
      sarvamOpenUntil = Date.now() + SARVAM_BREAKER_COOLDOWN_MS; // trip it
      console.warn(
        `[llm] sarvam ${args.schemaName} failed; skipping sarvam for ${
          SARVAM_BREAKER_COOLDOWN_MS / 1000
        }s, using openai: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      return openaiFallback();
    }
  }

  return timed(label, () => withRetry(run, { attempts: 2 }), detail);
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
/* -------------------------------------------------------------------------- */
/*                          Batch preparation                                 */
/* -------------------------------------------------------------------------- */

export interface PreparedQuestion {
  /** The skill this assesses, or null for an unscored comfort question. */
  skillId: WorkSkillId | null;
  question: string;
  translation: string | null;
  /** The same question, restated for someone who did not follow it. */
  easier: string;
  easierTranslation: string | null;
  /** Follow-ups that work whatever the candidate said. Two, in a fixed order. */
  probes: { text: string; translation: string | null }[];
}

export const preparedBatchSchema = z.object({
  questions: z
    .array(
      z.object({
        skillId: z.string(),
        question: z.string().min(1).max(600),
        questionTranslation: z.string().max(600),
        easierQuestion: z.string().min(1).max(600),
        easierQuestionTranslation: z.string().max(600),
        probeExample: z.string().min(1).max(400),
        probeOutcome: z.string().min(1).max(400),
      }),
    )
    // Generous rather than exact. This is a guard against a runaway
    // response, not a restatement of how many questions we asked for: the
    // caller takes the ones it wants and ignores the rest, so a model that
    // returns one extra should not cost the whole batch a retry.
    .max(16),
});

const PREPARED_BATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "skillId",
          "question",
          "questionTranslation",
          "easierQuestion",
          "easierQuestionTranslation",
          "probeExample",
          "probeOutcome",
        ],
        properties: {
          skillId: {
            type: "string",
            description:
              'The work skill id given for this question, copied exactly. Use "comfort" for a warm-up question.',
          },
          question: {
            type: "string",
            description: "The question, in the interview language.",
          },
          questionTranslation: {
            type: "string",
            description:
              "Plain English translation. Empty string when the interview is already English.",
          },
          easierQuestion: {
            type: "string",
            description:
              "The SAME question, shorter and simpler, the way a person rephrases when someone did not follow. Never answers it, hints at an answer, or asks something different.",
          },
          easierQuestionTranslation: {
            type: "string",
            description: "Plain English translation of easierQuestion.",
          },
          probeExample: {
            type: "string",
            description:
              "A follow-up asking for ONE concrete instance — when, where, what actually happened. Must work whatever they answered.",
          },
          probeOutcome: {
            type: "string",
            description:
              "A follow-up asking what the result was, or what they would do differently. Must work whatever they answered.",
          },
        },
      },
    },
  },
} as const;

/**
 * Write a batch of questions, each with a simpler restatement and two
 * follow-up probes, before the candidate reaches them.
 *
 * This is what lets the interview run without a model call in it. Everything
 * the interviewer might say for these turns is written here, once, and voiced
 * in the background; the interview itself then only ever picks between things
 * that already exist.
 *
 * A batch rather than one question at a time because the model can see its own
 * siblings and avoid writing four variations of "tell me about a time you were
 * late". Batches stay small — four skills — because output grows fast in a
 * non-Latin script and the provider budgets are per call.
 *
 * The two probes are named and differently shaped on purpose. A `probes: []`
 * array reliably produces two paraphrases of "tell me more"; asking separately
 * for a concrete instance and for the outcome produces two questions worth
 * asking.
 */
export async function prepareQuestions(args: {
  ctx: InterviewContext;
  /** The skills to write for, in order. Empty means comfort questions. */
  skills: WorkSkill[];
  /** How many warm-up questions to write when `skills` is empty. */
  comfortCount?: number;
  /** Everything already asked, so this batch does not repeat it. */
  history: PriorTurn[];
}): Promise<PreparedQuestion[]> {
  const { ctx, skills, comfortCount = 0, history } = args;
  const isComfort = skills.length === 0;

  const expected = isComfort ? comfortCount : skills.length;

  const brief = isComfort
    ? [
        `Write EXACTLY ${comfortCount} WARM-UP questions to open the interview.`,
        `They are NOT scored. Their only job is to get a nervous person`,
        `talking: easy, personal, impossible to get wrong. Ask about what`,
        `they are studying, what they enjoy, a normal day. Never about a`,
        `weakness, a failure, or anything they must justify.`,
        `Set skillId to "comfort" for every one.`,
      ]
    : [
        `Write EXACTLY ${skills.length} questions — ONE for each of the skills`,
        `below, in this order. Do not write questions for any other skill.`,
        `Copy the skill id into skillId exactly as given.`,
        "",
        skills.map((skill) => skillBlock(skill)).join("\n\n"),
      ];

  const result = await requestStructured({
    instructions: interviewerRules(ctx),
    input: [
      contextBlock(ctx),
      // The framework names all ten work skills. Sending it alongside a
      // request for two warm-up questions had the model write one question
      // per skill instead — so it goes only to the batches that are actually
      // about skills.
      ...(isComfort ? [] : ["", frameworkBlock()]),
      ...(history.length > 0
        ? [
            "",
            "## Questions already asked (never repeat these, or anything close)",
            historyBlock(history),
          ]
        : []),
      "",
      ...brief,
      "",
      `For EVERY question also write easierQuestion (the same question,`,
      `simpler) and two follow-ups: probeExample and probeOutcome. The`,
      `follow-ups are asked AFTER an answer you cannot see, so they must make`,
      `sense whatever the candidate said — keep them short and general.`,
      "",
      `Return exactly ${expected} entries in "questions".`,
    ].join("\n"),
    schemaName: "prepared_questions",
    jsonSchema: PREPARED_BATCH_JSON_SCHEMA,
    validator: preparedBatchSchema,
    kind: "preparation",
  });

  return result.questions.map((row, index) => {
    const translate = (value: string): string | null => {
      if (ctx.language.promptName === "English") return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    return {
      skillId: isComfort ? null : (skills[index]?.id ?? null),
      question: row.question.trim(),
      translation: translate(row.questionTranslation),
      easier: row.easierQuestion.trim(),
      easierTranslation: translate(row.easierQuestionTranslation),
      probes: [
        { text: row.probeExample.trim(), translation: translate("") },
        { text: row.probeOutcome.trim(), translation: translate("") },
      ],
    };
  });
}

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
        ? [
            "",
            "## Questions already asked (never repeat these)",
            historyBlock(history),
          ]
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
    kind: "conversation",
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
  /**
   * Score the answer and nothing else.
   *
   * Distinct from "this was the last question": the look-ahead pipeline
   * writes the next question separately, so scoring a mid-interview answer
   * needs none back — but saying so by passing a null skill told the model
   * it had reached the end, framing every answer as a closing one.
   */
  scoreOnly?: boolean;
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
    scoreOnly = false,
    nextIsFollowUp,
  } = args;

  const isFinalTurn = turnNumber >= ctx.questionCount;

  const nextInstruction = scoreOnly
    ? [
        `Score this answer only. Another step writes the next question, so`,
        `set nextQuestion to null and interviewComplete to false. This is`,
        `NOT the end of the interview — judge the answer on its own terms.`,
      ].join("\n")
    : isFinalTurn
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
    // `scoreOnly` is the look-ahead pipeline's background marking: nobody is
    // waiting on it, so it gets the slower, more considered analysis model.
    // The combined call writes the question the candidate is about to hear
    // and is on the critical path, so it stays on the conversational one.
    kind: scoreOnly ? "analysis" : "conversation",
  });

  // The question budget and completion are enforced server-side: never let the
  // model overrun the configured count or end the interview early.
  // Scoring only: the caller wants marks, not a question, and must not be
  // told the interview is over.
  if (scoreOnly) {
    return {
      ...evaluation,
      interviewComplete: false,
      nextQuestion: null,
      questionTranslation: "",
    };
  }

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

/**
 * Score an answer and, only when it is worth digging into, produce ONE
 * follow-up on the same skill.
 *
 * Used for skills an admin marked follow-up-eligible. The follow-up (or its
 * absence) rides back in `nextQuestion`: a string means "ask this deeper
 * question", null means "the answer did not warrant one, move on".
 */
export async function scoreAndMaybeFollowUp(args: {
  ctx: InterviewContext;
  history: PriorTurn[];
  currentSkill: WorkSkill;
  currentQuestion: string;
  answerTranscript: string;
  /** 1-based skill number, for "question N of …" framing only. */
  skillNumber: number;
}): Promise<TurnEvaluation> {
  const {
    ctx,
    history,
    currentSkill,
    currentQuestion,
    answerTranscript,
    skillNumber,
  } = args;

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
      `This is skill ${skillNumber} of the interview.`,
      `Question asked: ${currentQuestion}`,
      `Candidate answer (in ${ctx.language.promptName}, keep it in that language): ${untrusted(
        "ANSWER",
        answerTranscript,
      )}`,
      "",
      `Score this answer for ${currentSkill.label} only.`,
      `Then decide whether ONE follow-up on the SAME skill is worth asking:`,
      `- If the answer was substantial and specific — a real example with more`,
      `  to explore — put a single follow-up in nextQuestion that refers to`,
      `  something the candidate actually said and probes deeper, written in`,
      `  ${ctx.language.promptName}, with its English rendering in`,
      `  questionTranslation.`,
      `- If the answer was thin, vague, evasive, or already complete, set`,
      `  nextQuestion to null. Never invent a follow-up just to have one.`,
      `Set interviewComplete to false.`,
    ].join("\n"),
    schemaName: "interview_turn",
    jsonSchema: TURN_JSON_SCHEMA,
    validator: turnEvaluationSchema,
    kind: "conversation",
  });

  return { ...evaluation, interviewComplete: false };
}

/** Final report for the reviewer, written in English. */
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
      `Write the candidate's closing report in ENGLISH — it is the reviewer's`,
      `summary, not read back to the candidate.`,
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
      `areas and the areas to improve — all in ENGLISH.`,
    ].join("\n"),
    schemaName: "interview_summary",
    jsonSchema: SUMMARY_JSON_SCHEMA,
    validator: interviewSummarySchema,
    kind: "analysis",
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
      "Preserve the meaning and the scenario exactly.",
      "Do not answer it, shorten it, or ask anything different.",
      // Same register rule as `interviewerRules`. Without it the re-ask
      // after a language switch came back in formal, literary language
      // while every other question in the interview was conversational.
      "Write SPOKEN language, the way people actually talk at work — not",
      "literary, news-reader or textbook language. Keep ordinary workplace",
      "words in English inside the sentence (customer, team, manager, shift,",
      "problem, handle, solve), as people really speak. Prefer the English",
      "verb with the local helper verb over the formal native verb.",
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
    kind: "conversation",
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
