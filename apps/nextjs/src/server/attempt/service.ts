import "server-only";

import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  interviewAttemptsTable,
  interviewTurnsTable,
} from "~/server/db/schema";
import type {
  Interview,
  InterviewAttempt,
  InterviewTurn,
} from "~/server/db/schema";
import {
  LANGUAGE_CONFIDENCE_THRESHOLD,
  languageFromCode,
  resolveInterviewLanguage,
} from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import {
  PROBE_QUESTION_TEXT,
  PROBE_SPOKEN_LANGUAGE_CODE,
} from "~/config/greeting";
import {
  LANGUAGE_PROBE_TURN,
  getWorkSkill,
  isAttemptFollowUp,
  skillForAttemptTurn,
  totalTurns,
  WORK_SKILLS,
} from "~/config/work-skills";
import type { WorkSkillId } from "~/config/work-skills";
import { ProviderError, toUserMessage } from "~/server/services/errors";
import {
  evaluateAnswerAndGetNextQuestion,
  generateFirstQuestion,
  generateInterviewSummary,
} from "~/server/services/openai";
import type { InterviewContext, PriorTurn } from "~/server/services/openai";
import { generateSpeech, transcribeAudio } from "~/server/services/sarvam";
import { loadAudioBytes, storeAudio } from "~/server/interview/audio";
import { generateToken } from "~/server/admin/service";

/**
 * Candidate attempt orchestration.
 *
 * Concurrency, unchanged in spirit from before and still entirely in the
 * database: every read is scoped to one attempt, a turn is claimed with a
 * single conditional UPDATE ... RETURNING (so a double submit cannot process
 * twice), a unique index on (attempt_id, turn_number) is the backstop against
 * duplicate turns, and provider calls happen outside transactions.
 *
 * Language, which is new: turn 1 is an unscored probe spoken in a neutral
 * language. Sarvam transcribes it with `language_code: "unknown"` and reports
 * what it heard; that becomes the attempt's language for everything after.
 * Every later answer is also transcribed with detection on, so a candidate who
 * switches language mid-interview is followed rather than mistranscribed.
 */

export const STALE_PROCESSING_MS = 3 * 60 * 1000;

export class AttemptError extends Error {
  readonly userMessage: string;
  readonly code: "not_found" | "invalid_state" | "provider_failed";

  constructor(
    code: AttemptError["code"],
    userMessage: string,
    message?: string,
  ) {
    super(message ?? userMessage);
    this.name = "AttemptError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Creation                                  */
/* -------------------------------------------------------------------------- */

export interface CandidateDetails {
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Start a new attempt on a shared interview.
 *
 * Returns the access token exactly once; the caller puts it in an httpOnly
 * cookie and it is never sent to the browser again.
 */
export async function createAttempt(
  interview: Interview,
  details: CandidateDetails,
): Promise<{ attemptId: string; accessToken: string }> {
  const accessToken = generateToken();

  const [row] = await db
    .insert(interviewAttemptsTable)
    .values({
      interviewId: interview.id,
      accessToken,
      candidateName: details.name,
      candidateEmail: details.email,
      candidatePhone: details.phone,
      status: "not_started",
    })
    .returning({ id: interviewAttemptsTable.id });

  if (!row) throw new Error("Failed to create attempt");
  return { attemptId: row.id, accessToken };
}

/* -------------------------------------------------------------------------- */
/*                                   Reads                                    */
/* -------------------------------------------------------------------------- */

export async function getTurns(attemptId: string): Promise<InterviewTurn[]> {
  return db.query.interviewTurnsTable.findMany({
    where: eq(interviewTurnsTable.attemptId, attemptId),
    orderBy: asc(interviewTurnsTable.turnNumber),
  });
}

async function reload(attemptId: string): Promise<InterviewAttempt> {
  const found = await db.query.interviewAttemptsTable.findFirst({
    where: eq(interviewAttemptsTable.id, attemptId),
  });
  if (!found) {
    throw new AttemptError("not_found", "That interview could not be found.");
  }
  return found;
}

function contextFor(
  attempt: InterviewAttempt,
  interview: Interview,
  introduction?: string | null,
): InterviewContext {
  if (!attempt.language) {
    throw new AttemptError(
      "invalid_state",
      "The interview language has not been detected yet.",
    );
  }
  return {
    questionCount: interview.questionCount,
    language: resolveInterviewLanguage(attempt.language),
    candidateIntroduction: introduction ?? null,
  };
}

/**
 * The candidate's opening answer, used as context for every later question.
 * Read fresh each time rather than cached, so it is correct after a retry.
 */
async function introductionFor(attemptId: string): Promise<string | null> {
  const probe = await db.query.interviewTurnsTable.findFirst({
    where: and(
      eq(interviewTurnsTable.attemptId, attemptId),
      eq(interviewTurnsTable.kind, "language_probe"),
    ),
  });
  return probe?.answerTranscript ?? null;
}

function toHistory(turns: InterviewTurn[]): PriorTurn[] {
  return turns
    .filter((t) => t.kind === "skill" && t.skillId)
    .map((t) => ({
      turnNumber: t.turnNumber,
      skillLabel: getWorkSkill(t.skillId as WorkSkillId).label,
      question: t.question,
      answerTranscript: t.answerTranscript,
    }));
}

/* -------------------------------------------------------------------------- */
/*                                   Start                                    */
/* -------------------------------------------------------------------------- */

/**
 * Begin an attempt by creating the language probe.
 *
 * Idempotent: a refresh or double click returns the existing state rather than
 * creating a second turn. No OpenAI call happens here — the probe is fixed
 * text, because we do not yet know what language to generate in.
 */
export async function startAttempt(attemptId: string): Promise<void> {
  const attempt = await reload(attemptId);
  const existing = await getTurns(attemptId);
  if (attempt.status !== "not_started" || existing.length > 0) return;

  const [claimed] = await db
    .update(interviewAttemptsTable)
    .set({
      status: "in_progress",
      currentQuestionNumber: LANGUAGE_PROBE_TURN,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(interviewAttemptsTable.id, attemptId),
        eq(interviewAttemptsTable.status, "not_started"),
      ),
    )
    .returning({ id: interviewAttemptsTable.id });

  // Another request won the race; it created the probe.
  if (!claimed) return;

  await db.insert(interviewTurnsTable).values({
    attemptId,
    turnNumber: LANGUAGE_PROBE_TURN,
    kind: "language_probe",
    skillId: null,
    question: PROBE_QUESTION_TEXT,
    status: "awaiting_answer",
  });

  await tryAttachQuestionAudio(
    attemptId,
    LANGUAGE_PROBE_TURN,
    PROBE_QUESTION_TEXT,
    PROBE_SPOKEN_LANGUAGE_CODE,
  );
}

/* -------------------------------------------------------------------------- */
/*                              Question audio                                */
/* -------------------------------------------------------------------------- */

async function tryAttachQuestionAudio(
  attemptId: string,
  turnNumber: number,
  text: string,
  languageCode: string,
): Promise<boolean> {
  try {
    const speech = await generateSpeech(text, { languageCode });
    const audioId = await storeAudio({
      attemptId,
      kind: "question",
      mimeType: speech.mimeType,
      data: speech.audio,
    });
    await db
      .update(interviewTurnsTable)
      .set({ questionAudioId: audioId, updatedAt: new Date() })
      .where(
        and(
          eq(interviewTurnsTable.attemptId, attemptId),
          eq(interviewTurnsTable.turnNumber, turnNumber),
        ),
      );
    return true;
  } catch (error) {
    // Audio is best-effort: the question is still readable on screen.
    console.error(
      `[attempt] question TTS failed attempt=${attemptId} turn=${turnNumber}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return false;
  }
}

export async function regenerateQuestionAudio(
  attempt: InterviewAttempt,
  turnNumber: number,
): Promise<boolean> {
  const turns = await getTurns(attempt.id);
  const turn = turns.find((t) => t.turnNumber === turnNumber);
  if (!turn || turn.questionAudioId) return Boolean(turn?.questionAudioId);

  const code =
    turn.kind === "language_probe" || !attempt.language
      ? PROBE_SPOKEN_LANGUAGE_CODE
      : resolveInterviewLanguage(attempt.language).code;

  return tryAttachQuestionAudio(attempt.id, turnNumber, turn.question, code);
}

/* -------------------------------------------------------------------------- */
/*                              Answer submission                             */
/* -------------------------------------------------------------------------- */

export interface SubmitResult {
  status: "processing" | "already_processing";
  turnId: string;
}

export async function submitAnswer(args: {
  attempt: InterviewAttempt;
  turnNumber: number;
  audio: Buffer;
  mimeType: string;
}): Promise<SubmitResult> {
  const { attempt } = args;

  if (attempt.status === "completed") {
    throw new AttemptError(
      "invalid_state",
      "This interview is already complete.",
    );
  }
  if (attempt.status === "not_started") {
    throw new AttemptError("invalid_state", "This interview has not started.");
  }

  const turns = await getTurns(attempt.id);
  const turn = turns.find((t) => t.turnNumber === args.turnNumber);
  if (!turn) {
    throw new AttemptError("not_found", "That question could not be found.");
  }
  // The active turn is authoritative on the server; a client cannot skip ahead.
  if (turn.turnNumber !== attempt.currentQuestionNumber) {
    throw new AttemptError(
      "invalid_state",
      "That question is no longer the active one. Refresh the page.",
    );
  }
  if (turn.status === "completed") {
    throw new AttemptError(
      "invalid_state",
      "You have already answered this question.",
    );
  }

  const audioId = await storeAudio({
    attemptId: attempt.id,
    kind: "answer",
    mimeType: args.mimeType,
    data: args.audio,
  });

  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);

  // Compare-and-swap: exactly one concurrent caller can match this predicate.
  const [claimed] = await db
    .update(interviewTurnsTable)
    .set({
      status: "processing",
      processingStartedAt: new Date(),
      answerAudioId: audioId,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(interviewTurnsTable.id, turn.id),
        or(
          inArray(interviewTurnsTable.status, ["awaiting_answer", "failed"]),
          and(
            eq(interviewTurnsTable.status, "processing"),
            lt(interviewTurnsTable.processingStartedAt, staleCutoff),
          ),
        ),
      ),
    )
    .returning({ id: interviewTurnsTable.id });

  if (!claimed) return { status: "already_processing", turnId: turn.id };

  await db
    .update(interviewAttemptsTable)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  return { status: "processing", turnId: turn.id };
}

/* -------------------------------------------------------------------------- */
/*                                 Processing                                 */
/* -------------------------------------------------------------------------- */

async function failTurn(
  attemptId: string,
  turnId: string,
  userMessage: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(interviewTurnsTable)
      .set({
        status: "failed",
        errorMessage: userMessage,
        processingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(interviewTurnsTable.id, turnId));

    await tx
      .update(interviewAttemptsTable)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(interviewAttemptsTable.id, attemptId));
  });
}

/**
 * The long half of a submission. Runs outside the request via `after()`, so
 * every state change is durable and a crash leaves the turn recoverable.
 */
export async function processTurn(
  attemptId: string,
  turnId: string,
  interview: Interview,
): Promise<void> {
  const attempt = await reload(attemptId).catch(() => null);
  const turn = await db.query.interviewTurnsTable.findFirst({
    where: and(
      eq(interviewTurnsTable.id, turnId),
      eq(interviewTurnsTable.attemptId, attemptId),
    ),
  });
  if (!attempt || !turn || !turn.answerAudioId) {
    console.error(`[attempt] processTurn: missing state turn=${turnId}`);
    return;
  }

  try {
    const audioRow = await loadAudioBytes({
      audioId: turn.answerAudioId,
      attemptId,
    });
    if (!audioRow) {
      await failTurn(
        attemptId,
        turnId,
        "Your recording could not be read. Please record the answer again.",
      );
      return;
    }

    // --- 1. Transcribe, with detection always on ---------------------------
    // "unknown" lets Sarvam identify the language, which is how both the
    // initial detection and a later switch are noticed.
    const { transcript, languageCode, languageProbability } =
      await transcribeAudio({
        audio: audioRow.data,
        mimeType: audioRow.mimeType,
        languageCode: "unknown",
      });

    if (!transcript || transcript.trim().length < 2) {
      await failTurn(
        attemptId,
        turnId,
        "We could not hear an answer in that recording. Please check your microphone and record again.",
      );
      return;
    }

    const detected = languageFromCode(languageCode);
    const confident =
      (languageProbability ?? 0) >= LANGUAGE_CONFIDENCE_THRESHOLD;

    if (turn.kind === "language_probe") {
      await completeProbe({
        attempt,
        interview,
        turnId,
        transcript,
        languageCode,
        detected,
        confident,
      });
      return;
    }

    // --- 2. A candidate who switched language is followed ------------------
    let activeLanguage = attempt.language as InterviewLanguageKey | null;
    if (detected && confident && detected !== activeLanguage) {
      activeLanguage = detected;
      await db
        .update(interviewAttemptsTable)
        .set({
          language: detected,
          languageConfidence: languageProbability ?? null,
          updatedAt: new Date(),
        })
        .where(eq(interviewAttemptsTable.id, attemptId));
      console.info(
        `[attempt] language switched attempt=${attemptId} -> ${detected}`,
      );
    }
    if (!activeLanguage) {
      await failTurn(
        attemptId,
        turnId,
        "We could not determine your language. Please choose one and try again.",
      );
      return;
    }

    await evaluateSkillTurn({
      attempt: { ...attempt, language: activeLanguage },
      interview,
      turn,
      transcript,
      languageCode,
    });
  } catch (error) {
    const message =
      error instanceof ProviderError ? error.userMessage : toUserMessage(error);
    console.error(
      `[attempt] processTurn failed attempt=${attemptId} turn=${turnId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    await failTurn(attemptId, turnId, message);
  }
}

/**
 * Finish the language probe.
 *
 * On a confident, supported detection the attempt is locked to that language
 * and the first real question is generated. Otherwise the candidate is asked
 * to choose — we never guess a language and conduct a whole interview in it.
 */
async function completeProbe(args: {
  attempt: InterviewAttempt;
  interview: Interview;
  turnId: string;
  transcript: string;
  languageCode: string | null;
  detected: InterviewLanguageKey | null;
  confident: boolean;
}): Promise<void> {
  const { attempt, interview, turnId, transcript, languageCode } = args;

  await db
    .update(interviewTurnsTable)
    .set({
      answerTranscript: transcript,
      detectedLanguageCode: languageCode,
      status: "completed",
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turnId));

  if (!args.detected || !args.confident) {
    await db
      .update(interviewAttemptsTable)
      .set({
        needsLanguageChoice: true,
        status: "in_progress",
        updatedAt: new Date(),
      })
      .where(eq(interviewAttemptsTable.id, attempt.id));
    return;
  }

  await db
    .update(interviewAttemptsTable)
    .set({
      language: args.detected,
      languageConfidence: null,
      needsLanguageChoice: false,
      status: "in_progress",
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  await generateNextQuestion(attempt.id, interview, LANGUAGE_PROBE_TURN + 1);
}

/** Candidate picked a language after detection failed. */
export async function chooseLanguage(
  attempt: InterviewAttempt,
  interview: Interview,
  languageKey: string,
): Promise<void> {
  const language = resolveInterviewLanguage(languageKey);

  await db
    .update(interviewAttemptsTable)
    .set({
      language: language.key,
      needsLanguageChoice: false,
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  const turns = await getTurns(attempt.id);
  const next = LANGUAGE_PROBE_TURN + 1;
  if (turns.some((t) => t.turnNumber === next)) return;

  await generateNextQuestion(attempt.id, interview, next);
}

/** Create and voice one skill question. */
async function generateNextQuestion(
  attemptId: string,
  interview: Interview,
  turnNumber: number,
): Promise<void> {
  const attempt = await reload(attemptId);
  const skill = skillForAttemptTurn(turnNumber, interview.questionCount);
  if (!skill) return;

  const ctx = contextFor(attempt, interview, await introductionFor(attemptId));
  const generated = await generateFirstQuestion(ctx, skill);

  await db
    .insert(interviewTurnsTable)
    .values({
      attemptId,
      turnNumber,
      kind: "skill",
      skillId: skill.id,
      isFollowUp: isAttemptFollowUp(turnNumber, interview.questionCount),
      question: generated.question,
      questionTranslation: generated.translation,
      status: "awaiting_answer",
    })
    .onConflictDoNothing();

  await db
    .update(interviewAttemptsTable)
    .set({
      status: "in_progress",
      currentQuestionNumber: turnNumber,
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attemptId));

  await tryAttachQuestionAudio(
    attemptId,
    turnNumber,
    generated.question,
    ctx.language.code,
  );
}

/** Score one answer and prepare the next question, or finish. */
async function evaluateSkillTurn(args: {
  attempt: InterviewAttempt;
  interview: Interview;
  turn: InterviewTurn;
  transcript: string;
  languageCode: string | null;
}): Promise<void> {
  const { attempt, interview, turn, transcript, languageCode } = args;
  const ctx = contextFor(attempt, interview, await introductionFor(attempt.id));

  const priorTurns = await db.query.interviewTurnsTable.findMany({
    where: and(
      eq(interviewTurnsTable.attemptId, attempt.id),
      lt(interviewTurnsTable.turnNumber, turn.turnNumber),
    ),
    orderBy: asc(interviewTurnsTable.turnNumber),
  });

  const last = totalTurns(interview.questionCount);
  const nextTurnNumber = turn.turnNumber + 1;
  const hasNext = nextTurnNumber <= last;
  const nextSkill = hasNext
    ? skillForAttemptTurn(nextTurnNumber, interview.questionCount)
    : null;

  const evaluation = await evaluateAnswerAndGetNextQuestion({
    ctx,
    history: toHistory(priorTurns),
    currentSkill: getWorkSkill(turn.skillId as WorkSkillId),
    currentQuestion: turn.question,
    answerTranscript: transcript,
    turnNumber: turn.turnNumber - LANGUAGE_PROBE_TURN,
    nextSkill,
    nextIsFollowUp: hasNext
      ? isAttemptFollowUp(nextTurnNumber, interview.questionCount)
      : false,
  });

  const willComplete = evaluation.interviewComplete || !nextSkill;

  await db.transaction(async (tx) => {
    await tx
      .update(interviewTurnsTable)
      .set({
        answerTranscript: transcript,
        detectedLanguageCode: languageCode,
        score: evaluation.score,
        evaluation: evaluation.evaluation,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
        status: "completed",
        errorMessage: null,
        processingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(interviewTurnsTable.id, turn.id));

    if (!willComplete && evaluation.nextQuestion && nextSkill) {
      await tx
        .insert(interviewTurnsTable)
        .values({
          attemptId: attempt.id,
          turnNumber: nextTurnNumber,
          kind: "skill",
          skillId: nextSkill.id,
          isFollowUp: isAttemptFollowUp(
            nextTurnNumber,
            interview.questionCount,
          ),
          question: evaluation.nextQuestion,
          questionTranslation: evaluation.questionTranslation.trim() || null,
          status: "awaiting_answer",
        })
        .onConflictDoNothing();

      await tx
        .update(interviewAttemptsTable)
        .set({
          status: "in_progress",
          currentQuestionNumber: nextTurnNumber,
          updatedAt: new Date(),
        })
        .where(eq(interviewAttemptsTable.id, attempt.id));
    }
  });

  if (willComplete) {
    await finaliseAttempt(attempt.id, interview);
  } else if (evaluation.nextQuestion) {
    await tryAttachQuestionAudio(
      attempt.id,
      nextTurnNumber,
      evaluation.nextQuestion,
      ctx.language.code,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Completion                                 */
/* -------------------------------------------------------------------------- */

async function finaliseAttempt(
  attemptId: string,
  interview: Interview,
): Promise<void> {
  const attempt = await reload(attemptId);
  const turns = await getTurns(attemptId);
  const answered = turns.filter(
    (t) => t.kind === "skill" && t.status === "completed",
  );
  const skillScores = aggregateSkillScores(turns);

  let overallScore: number | null = null;
  let summary: string | null = null;
  let strengths: string[] = [];
  let improvements: string[] = [];

  try {
    const report = await generateInterviewSummary({
      ctx: contextFor(attempt, interview, await introductionFor(attemptId)),
      history: toHistory(answered),
      skillScores: skillScores.map((s) => ({
        skillLabel: getWorkSkill(s.skillId).label,
        score: s.score,
      })),
    });
    overallScore = report.overallScore;
    summary = report.summary;
    strengths = report.strengths;
    improvements = report.improvements;
  } catch (error) {
    // A summary failure must not strand a finished interview.
    console.error(
      `[attempt] summary failed attempt=${attemptId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    const scored = skillScores.filter((s) => s.score !== null);
    if (scored.length > 0) {
      const total = scored.reduce((sum, s) => sum + (s.score ?? 0), 0);
      overallScore = Math.round((total / (scored.length * 10)) * 100);
    }
    summary =
      "The detailed summary could not be generated, but the per-question feedback below is complete.";
  }

  await db
    .update(interviewAttemptsTable)
    .set({
      status: "completed",
      overallScore,
      summary,
      strengths,
      improvements,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attemptId));
}

/* -------------------------------------------------------------------------- */
/*                             Skill aggregation                              */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*                             Status and recovery                            */
/* -------------------------------------------------------------------------- */

export interface AttemptStatus {
  attemptStatus: InterviewAttempt["status"];
  currentQuestionNumber: number;
  totalTurns: number;
  needsLanguageChoice: boolean;
  language: string | null;
  isComplete: boolean;
  /** Sarvam's transcript of the previous answer, shown back to confirm it. */
  lastTranscript: string | null;
  turn: {
    turnNumber: number;
    kind: InterviewTurn["kind"];
    question: string;
    questionTranslation: string | null;
    questionAudioId: string | null;
    status: InterviewTurn["status"];
    errorMessage: string | null;
    skillId: WorkSkillId | null;
  } | null;
}

/**
 * Poll target. Also recovers a turn abandoned mid-processing so the UI can
 * offer a retry instead of spinning forever.
 */
export async function getAttemptStatus(
  attemptId: string,
  interview: Interview,
): Promise<AttemptStatus> {
  let attempt = await reload(attemptId);
  let turns = await getTurns(attemptId);

  const active = turns.find(
    (t) => t.turnNumber === attempt.currentQuestionNumber,
  );

  if (
    active?.status === "processing" &&
    active.processingStartedAt &&
    Date.now() - active.processingStartedAt.getTime() > STALE_PROCESSING_MS
  ) {
    await failTurn(
      attemptId,
      active.id,
      "Processing timed out. Please submit your answer again.",
    );
    attempt = await reload(attemptId);
    turns = await getTurns(attemptId);
  }

  const current =
    turns.find((t) => t.turnNumber === attempt.currentQuestionNumber) ?? null;

  return {
    attemptStatus: attempt.status,
    currentQuestionNumber: attempt.currentQuestionNumber,
    totalTurns: totalTurns(interview.questionCount),
    needsLanguageChoice: attempt.needsLanguageChoice,
    language: attempt.language,
    isComplete: attempt.status === "completed",
    lastTranscript:
      turns.filter((t) => t.status === "completed" && t.answerTranscript).at(-1)
        ?.answerTranscript ?? null,
    turn: current
      ? {
          turnNumber: current.turnNumber,
          kind: current.kind,
          question: current.question,
          questionTranslation: current.questionTranslation,
          questionAudioId: current.questionAudioId,
          status: current.status,
          errorMessage: current.errorMessage,
          skillId: (current.skillId as WorkSkillId | null) ?? null,
        }
      : null,
  };
}

/** Light proctoring signal: increment in SQL, no read-modify-write race. */
export async function recordAway(attemptId: string): Promise<void> {
  await db
    .update(interviewAttemptsTable)
    .set({
      awayCount: sql`${interviewAttemptsTable.awayCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attemptId));
}
