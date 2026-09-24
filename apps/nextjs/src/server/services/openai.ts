import "server-only";
import { recordUsage } from "~/server/interview/usage";

import OpenAI from "openai";
import { z } from "zod";

import { env } from "~/env";
import type { WorkSkill } from "~/config/work-skills";
import { ProviderError, isRetryableStatus, withRetry } from "./errors";
import { timed } from "./timing";
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
      // Billed tokens, straight from the response. Free to read, and the only
      // honest source — a token count estimated from characters is not one.
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
 * Is this utterance an ANSWER, or a DOUBT the interviewer should respond to?
 *
 * A real interviewer never scores "sorry, can you say that again?" or "what do
 * you mean?" as the answer — they respond and re-ask. This replaces the old
 * fixed phrase list with the model's judgment, so any phrasing of a doubt, in
 * any language, is caught rather than only the ones someone thought to list.
 *
 * Deliberately tiny and on the "conversation" (fast) model: it runs on the
 * candidate's critical path, before we decide whether to score or re-ask.
 */
export async function classifyUtterance(args: {
  question: string;
  transcript: string;
  /** Interview language, so the model reads the question in context. */
  languageName: string;
}): Promise<"answer" | "doubt"> {
  const result = await requestStructured({
    instructions: [
      "You triage ONE thing a candidate said in a spoken interview.",
      "Decide whether it ANSWERS the interviewer's question, or is a DOUBT",
      "raised INSTEAD of answering: a request to repeat, 'I didn't understand',",
      "'I don't know' / 'no idea', asking what to say or for the answer, asking",
      "a question back, OR mere",
      "filler with no substance — 'okay', 'um', 'hmm', a false start, or",
      "near-silence that says nothing about the question. All of those are a",
      "DOUBT (the candidate needs the question again), not an answer.",
      "A brief but GENUINE attempt to answer — even vague or partial — is an",
      "ANSWER. When it is a real attempt, choose answer.",
      "Return intent only.",
    ].join(" "),
    input: [
      `Interviewer asked (in ${args.languageName}): ${args.question}`,
      `Candidate said: ${untrusted("CANDIDATE", args.transcript)}`,
    ].join("\n"),
    schemaName: "utterance_intent",
    jsonSchema: {
      type: "object",
      properties: { intent: { type: "string", enum: ["answer", "doubt"] } },
      required: ["intent"],
      additionalProperties: false,
    },
    validator: z.object({ intent: z.enum(["answer", "doubt"]) }),
    kind: "conversation",
  });
  return result.intent;
}

/**
 * A short SPOKEN reply to a candidate's doubt — never written to the screen.
 *
 * The candidate asked something instead of answering ("what does this word
 * mean?", "I couldn't follow"), or said nothing usable. A real interviewer
 * answers that out loud and leaves the question standing. This produces only
 * the line to speak; the question text on screen never changes.
 */
export async function generateDoubtResponse(args: {
  question: string;
  doubtTranscript: string;
  /** Interview language — the reply is spoken in it, in its own script. */
  languageName: string;
}): Promise<string> {
  const result = await requestStructured({
    instructions: [
      "You are a warm, patient interviewer. The candidate did NOT answer your",
      "question — they raised a doubt about it. Reply BRIEFLY, as words spoken",
      `aloud, in ${args.languageName} written in that language's OWN script`,
      "(never Latin letters). If they did not understand a particular word,",
      "explain THAT word in simple everyday terms. If they could not follow,",
      "restate the question's meaning simply. If they said nothing meaningful,",
      "gently encourage them. Always end by inviting them to answer. One or two",
      "short sentences. NEVER answer the question for them or give an example",
      "answer.",
    ].join(" "),
    input: [
      `Your question was: ${args.question}`,
      `The candidate said: ${untrusted("CANDIDATE", args.doubtTranscript)}`,
    ].join("\n"),
    schemaName: "doubt_reply",
    jsonSchema: {
      type: "object",
      properties: { reply: { type: "string" } },
      required: ["reply"],
      additionalProperties: false,
    },
    validator: z.object({ reply: z.string() }),
    kind: "conversation",
  });
  const reply = result.reply.trim();
  if (!reply) {
    throw new ProviderError({
      provider: "openai",
      message: "empty doubt reply",
      userMessage: "We could not prepare a reply. Please try again.",
      retryable: true,
    });
  }
  return reply;
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
      `Score this answer for ${currentSkill.label} only, then decide ONE`,
      `follow-up on the SAME skill. Put it in nextQuestion (written in`,
      `${ctx.language.promptName}, English rendering in questionTranslation), or`,
      `null ONLY in the narrow cases listed below.`,
      `- DEFAULT to asking one follow-up. Almost every answer leaves a thread`,
      `  worth pulling: a specific example to draw out ("can you tell me about a`,
      `  time…"), the next concrete step ("what would you do first…"), the`,
      `  reasoning behind a choice, or how they handled the tricky part. Refer to`,
      `  something they actually said and make it feel like natural curiosity,`,
      `  not interrogation.`,
      `- PROBE before settling on a low score: if the answer is a genuine attempt`,
      `  but thin, general or hypothetical, the follow-up gives them a fair`,
      `  chance to show the skill.`,
      `- Return null ONLY when a follow-up would be pointless: the answer is`,
      `  empty, off-topic, a refusal / "I don't know" / skip, or already so`,
      `  thorough that one more question would just be padding. When in doubt, ASK.`,
      `- Never a hollow "is there anything you'd like to add?" — the follow-up`,
      `  must be a real, specific question about what they said.`,
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

/**
 * Re-ask a question the candidate did not catch — the SAME question, said
 * again more simply.
 *
 * For "can you repeat that?" / "I didn't understand". It must never answer the
 * question, hint at an answer, or drift to a different one — only restate what
 * was asked, in plainer words.
 */
export async function rephraseQuestionSimpler(
  ctx: InterviewContext,
  question: string,
): Promise<GeneratedQuestion> {
  const result = await requestStructured({
    instructions: [
      "The candidate did not catch an interview question and asked for it",
      `again. Say the SAME question again in ${ctx.language.promptName}, shorter`,
      "and simpler, the way a person would rephrase when someone did not hear.",
      "NEVER answer it, give an example answer, hint at what to say, or ask a",
      "different question — only restate what was asked, more clearly.",
      "Write SPOKEN language, keeping ordinary workplace words in English",
      "(customer, team, manager, shift). One short sentence. Return only that.",
    ].join(" "),
    input: [
      `Target language: ${ctx.language.promptName}.`,
      "",
      "Question to restate more simply:",
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

  const restated = result.question.trim();
  if (!restated) {
    throw new ProviderError({
      provider: "openai",
      message: "openai returned an empty re-ask",
      userMessage: "We could not repeat the question. Please try again.",
      retryable: true,
    });
  }

  const english = result.questionTranslation.trim();
  return {
    question: restated,
    translation:
      ctx.language.promptName === "English" || english === restated
        ? null
        : english || null,
  };
}
