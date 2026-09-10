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
} from "~/config/work-skills";
import type { WorkSkillId } from "~/config/work-skills";
import { isRepeatRequest } from "~/config/repeat-requests";
import { aggregateSkillScores } from "~/lib/scoring";
import { ProviderError, toUserMessage } from "~/server/services/errors";
import {
  evaluateAnswerAndGetNextQuestion,
  generateFirstQuestion,
  generateInterviewSummary,
  translateQuestion,
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

/**
 * Voice a question and store the clip, WITHOUT attaching it to a turn.
 *
 * Separate from attaching because of an ordering that matters: a question
 * must not become the candidate's current question until its audio exists.
 * The client polls every couple of seconds and reveals a new question the
 * moment it appears, while speech synthesis takes a second or two — attach
 * afterwards and there is a window where the candidate is shown a question
 * captioned "audio unavailable" that was never actually unavailable.
 *
 * Returns null rather than throwing: audio is best-effort, and a question
 * that cannot be voiced is still readable on screen.
 */
async function synthesiseQuestionAudio(
  attemptId: string,
  text: string,
  languageCode: string,
): Promise<string | null> {
  try {
    const speech = await generateSpeech(text, { languageCode });
    return await storeAudio({
      attemptId,
      kind: "question",
      mimeType: speech.mimeType,
      data: speech.audio,
    });
  } catch (error) {
    console.error(
      `[attempt] question TTS failed attempt=${attemptId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return null;
  }
}

/**
 * Voice a question that already exists and link it.
 *
 * Only for a turn the candidate can already see — the retry button, and the
 * probe, which is created before the interview screen is shown at all.
 */
async function tryAttachQuestionAudio(
  attemptId: string,
  turnNumber: number,
  text: string,
  languageCode: string,
): Promise<boolean> {
  const audioId = await synthesiseQuestionAudio(attemptId, text, languageCode);
  if (!audioId) return false;

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

  // NOTE: the recording is NOT written to R2 here. This runs inside the
  // request the candidate is waiting on, and an upload to object storage on
  // that path buys nothing — the bytes are already in memory, and archiving
  // them is not something the next question depends on. `processTurn` does
  // it from `after()`, alongside transcription, once the response has gone.
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);

  // Compare-and-swap: exactly one concurrent caller can match this predicate.
  const [claimed] = await db
    .update(interviewTurnsTable)
    .set({
      status: "processing",
      processingStartedAt: new Date(),
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

/**
 * Put a turn back to unanswered so the question can be asked again.
 *
 * Unlike `failTurn` this is not an error: nothing went wrong, the candidate
 * simply asked to hear the question again. No transcript is kept and no
 * score is written, so a repeat leaves no trace in the report.
 */
async function repeatTurn(attemptId: string, turnId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(interviewTurnsTable)
      .set({
        status: "awaiting_answer",
        errorMessage: null,
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
/**
 * The recording as it arrived, when the caller still has it in hand.
 *
 * A list, because the transcriber refuses audio over 30 seconds and the
 * browser therefore records a long answer as a series of complete files.
 * Usually there is exactly one.
 */
export interface AnswerAudio {
  segments: Buffer[];
  mimeType: string;
  /** Length the recorder measured, for the admin's per-answer marker. */
  durationMs?: number | null;
}

/**
 * Keep a copy of the recording, and point the turn at it.
 *
 * Never throws. The archive is for the admin to listen back to afterwards;
 * losing it must not cost the candidate their answer, which has already been
 * transcribed and scored from the same bytes.
 */
async function archiveAnswerAudio(
  attemptId: string,
  turnId: string,
  answer: AnswerAudio,
): Promise<void> {
  try {
    // Every segment is kept; the turn points at the first, and the rest
    // hang off the attempt. Concatenating them is not possible without
    // re-encoding, and the video already holds the answer end to end.
    const ids = [];
    for (const [index, data] of answer.segments.entries()) {
      ids.push(
        await storeAudio({
          attemptId,
          kind: "answer",
          mimeType: answer.mimeType,
          data,
          // The measured length belongs to the take, not to one slice of it.
          durationMs: index === 0 ? answer.durationMs : null,
        }),
      );
    }
    if (ids.length === 0) return;

    await db
      .update(interviewTurnsTable)
      .set({ answerAudioId: ids[0], updatedAt: new Date() })
      .where(eq(interviewTurnsTable.id, turnId));
  } catch (error) {
    console.error(
      `[attempt] archiving answer audio failed turn=${turnId}: ${
        error instanceof Error ? error.name : "unknown"
      }`,
    );
  }
}

/**
 * Transcribe an answer that may have arrived in several pieces.
 *
 * Sent one at a time rather than in parallel: the pieces are consecutive
 * speech and the transcript has to read in order, and firing five requests
 * at once is a good way to meet a rate limit mid-answer.
 *
 * The language reported is the one from the longest-transcribing segment —
 * the opening few words of a reply are the least reliable place to judge
 * from, and a candidate who switches language mid-answer should be read as
 * whatever they mostly spoke.
 */
async function transcribeSegments(answer: AnswerAudio): Promise<{
  transcript: string;
  languageCode: string | null;
  languageProbability: number | null;
}> {
  const parts: string[] = [];
  let best: { code: string | null; probability: number | null; len: number } = {
    code: null,
    probability: null,
    len: -1,
  };

  let failures = 0;

  for (const segment of answer.segments) {
    let result;
    try {
      result = await transcribeAudio({
        audio: segment,
        mimeType: answer.mimeType,
        languageCode: "unknown",
      });
    } catch (error) {
      // One bad slice must not lose the whole answer — a rollover can leave
      // a final fragment of a fraction of a second, which is exactly the
      // sort of thing a transcriber rejects.
      failures += 1;
      console.error(
        `[attempt] segment transcription failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      continue;
    }

    const text = result.transcript?.trim() ?? "";
    if (text) parts.push(text);
    if (text.length > best.len) {
      best = {
        code: result.languageCode,
        probability: result.languageProbability,
        len: text.length,
      };
    }
  }

  // Every slice failed: that is a real failure, and the caller should say so
  // rather than score an empty answer.
  if (failures > 0 && parts.length === 0) {
    throw new ProviderError({
      provider: "sarvam",
      message: `all ${failures} answer segments failed to transcribe`,
      userMessage:
        "We could not transcribe your answer just now. Please try again.",
      retryable: true,
    });
  }

  return {
    transcript: parts.join(" "),
    languageCode: best.code,
    languageProbability: best.probability,
  };
}

export async function processTurn(
  attemptId: string,
  turnId: string,
  interview: Interview,
  /**
   * The recording, when `processTurn` is called straight after the upload.
   * Absent when recovering a turn later, in which case it is read back from
   * storage instead.
   */
  answer?: AnswerAudio,
): Promise<void> {
  const attempt = await reload(attemptId).catch(() => null);
  const turn = await db.query.interviewTurnsTable.findFirst({
    where: and(
      eq(interviewTurnsTable.id, turnId),
      eq(interviewTurnsTable.attemptId, attemptId),
    ),
  });
  if (!attempt || !turn) {
    console.error(`[attempt] processTurn: missing state turn=${turnId}`);
    return;
  }

  try {
    // Fresh submission: use the bytes we were handed. Recovery: read the
    // archived copy back — only the first segment survives that route, so
    // a recovered long answer is transcribed from its opening 25 seconds.
    const recovered = turn.answerAudioId
      ? await loadAudioBytes({ audioId: turn.answerAudioId, attemptId })
      : null;

    const audioRow: AnswerAudio | null =
      answer ??
      (recovered
        ? { segments: [recovered.data], mimeType: recovered.mimeType }
        : null);

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
    //
    // Archiving runs alongside rather than before it: the two are
    // independent, and overlapping them keeps the turn as short as the
    // slower of the two rather than their sum.
    const [, transcription] = await Promise.all([
      answer
        ? archiveAnswerAudio(attemptId, turnId, answer)
        : Promise.resolve(),
      transcribeSegments(audioRow),
    ]);
    const { transcript, languageCode, languageProbability } = transcription;

    if (!transcript || transcript.trim().length < 2) {
      await failTurn(
        attemptId,
        turnId,
        "We could not hear an answer in that recording. Please check your microphone and record again.",
      );
      return;
    }

    // Asked to hear the question again rather than answering it. Checked
    // before anything is scored or the language is inferred — "sorry, say
    // that again" says nothing about either.
    if (isRepeatRequest(transcript)) {
      await repeatTurn(attemptId, turnId);
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

  // Nothing asked yet: the first real question is simply written in the
  // language that was just chosen.
  if (!turns.some((t) => t.turnNumber === next)) {
    await generateNextQuestion(attempt.id, interview, next);
    return;
  }

  // Mid-interview switch. Re-ask what is on screen right now in the new
  // language rather than waiting for the next question — a candidate who
  // says they cannot follow the language is telling us about the question
  // in front of them, and leaving it there makes them answer it anyway.
  const current = turns.find(
    (t) => t.turnNumber === attempt.currentQuestionNumber,
  );
  if (!current || current.status !== "awaiting_answer") return;
  if (current.kind === "language_probe") return;

  await reaskInLanguage(attempt.id, current, language);
}

/**
 * Rewrite one pending question into another language and re-voice it.
 *
 * Best-effort in both halves: if translation fails the question stays as it
 * was, which is worse than switching but far better than blanking the
 * question the candidate is looking at.
 */
async function reaskInLanguage(
  attemptId: string,
  turn: InterviewTurn,
  language: ReturnType<typeof resolveInterviewLanguage>,
): Promise<void> {
  // The English original is the best source to translate from — going
  // language A -> B directly compounds whatever A already lost.
  const source = turn.questionTranslation ?? turn.question;

  let rewritten;
  try {
    rewritten = await translateQuestion(
      {
        questionCount: 0,
        language,
        candidateIntroduction: null,
      },
      source,
    );
  } catch (error) {
    console.error(
      `[attempt] re-ask translation failed turn=${turn.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return;
  }

  // Voiced first, then swapped in as one update. Writing the new text with
  // the audio cleared and filling it in afterwards would leave the question
  // briefly captioned "audio unavailable"; a null here means TTS genuinely
  // failed, which is what the retry button is for.
  const questionAudioId = await synthesiseQuestionAudio(
    attemptId,
    rewritten.question,
    language.code,
  );

  await db
    .update(interviewTurnsTable)
    .set({
      question: rewritten.question,
      questionTranslation: rewritten.translation,
      questionAudioId,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turn.id));
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

  // Voiced before the turn is written, so it is never current without audio.
  const questionAudioId = await synthesiseQuestionAudio(
    attemptId,
    generated.question,
    ctx.language.code,
  );

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
      questionAudioId,
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

  // Voiced before the transaction that reveals it. The client advances the
  // moment `currentQuestionNumber` moves, so anything done after that point
  // is something the candidate can already see missing.
  const nextQuestionAudioId =
    !willComplete && evaluation.nextQuestion && nextSkill
      ? await synthesiseQuestionAudio(
          attempt.id,
          evaluation.nextQuestion,
          ctx.language.code,
        )
      : null;

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
          questionAudioId: nextQuestionAudioId,
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

  if (willComplete) await finaliseAttempt(attempt.id, interview);
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

/**
 * Re-exported from `~/lib/scoring`, which is where it now lives so the report
 * component can call it in the browser too. Kept here so existing server-side
 * callers do not all need rewriting.
 */
export { aggregateSkillScores };
export type { SkillScore } from "~/lib/scoring";

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
