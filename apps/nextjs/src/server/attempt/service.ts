import "server-only";

import { and, asc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { withUsageScope } from "~/server/interview/usage";
import {
  interviewAttemptsTable,
  interviewsTable,
  interviewAudioTable,
  interviewTurnVariantsTable,
  interviewTurnsTable,
  interviewsTable,
} from "~/server/db/schema";
import type {
  Interview,
  InterviewAttempt,
  InterviewTurn,
} from "~/server/db/schema";
import { resolveInterviewLanguage } from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import { OPENING_BY_KEY } from "~/config/greeting";
import {
  LANGUAGE_PROBE_TURN,
  WORK_SKILLS,
  WORK_SKILL_COUNT,
  WORK_SKILL_IDS,
  getWorkSkill,
} from "~/config/work-skills";
import type { WorkSkill, WorkSkillId } from "~/config/work-skills";
import { WORK_READINESS_QUESTIONS } from "~/config/work-readiness-pool";
import {
  isRepeatRequest,
  isSkipRequest,
  isSlowerRequest,
} from "~/config/repeat-requests";
import { aggregateSkillScores } from "~/lib/scoring";
import { ProviderError, toUserMessage } from "~/server/services/errors";
import {
  evaluateAnswerAndGetNextQuestion,
  generateInterviewSummary,
  prepareQuestions,
  generateQuestion,
  translateQuestion,
} from "~/server/services/openai";
import type { InterviewContext, PriorTurn } from "~/server/services/openai";
import { deliverResult } from "~/server/integrations/result-webhook";
import { env } from "~/env";
import { generateSpeech, transcribeAudio } from "~/server/services/sarvam";
import { timed } from "~/server/services/timing";
import { loadAudioBytes, storeAudio } from "~/server/interview/audio";
import { deleteAudioObject } from "~/server/interview/storage";
import { generateToken } from "~/server/admin/service";
import { withUsageScope } from "~/server/interview/usage";
import { recentActivity } from "~/server/services/dev-activity";
import type { ActivityEvent } from "~/server/services/dev-activity";

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

/**
 * A turn stuck "processing" longer than this recovers on the next poll,
 * offering a retry instead of spinning forever.
 *
 * Sized against the worst realistic pipeline now that the provider timeouts
 * are tight (see sarvam.ts / openai.ts): STT (~30s) + an OpenAI call (~40s) +
 * TTS for a follow-up (~24s) tops out under 100s even if every call times out
 * once and succeeds on retry. This used to be 3 minutes, which was not a
 * safety net so much as the ACTUAL latency candidates hit — a slow provider
 * legitimately took that long to fail through its own (much longer) retry
 * budget, and this was just when it got noticed and recovered.
 */
export const STALE_PROCESSING_MS = 2 * 60 * 1000;

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
  /** Interview language chosen up front; fixed for the whole session. */
  language: InterviewLanguageKey;
  /** Course / field of study, for grounding and pre-preparing questions. */
  course: string | null;
  /** Partner student id, when the candidate came through an integration link. */
  externalStudentId?: string | null;
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
      candidateCourse: details.course,
      externalStudentId: details.externalStudentId ?? null,
      language: details.language,
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
  priorAttempts?: string | null,
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
    candidateName: attempt.candidateName,
    candidateCourse: attempt.candidateCourse,
    candidateIntroduction: introduction ?? null,
    priorAttempts: priorAttempts ?? null,
  };
}

/**
 * Build the model context for an attempt, pulling the introduction and any
 * earlier-attempt digest in parallel. Prefer this over calling `contextFor`
 * directly so returning candidates always get their prior context.
 */
async function buildContext(
  attempt: InterviewAttempt,
  interview: Interview,
): Promise<InterviewContext> {
  const [introduction, priorAttempts] = await Promise.all([
    introductionFor(attempt.id),
    priorAttemptsContext(attempt),
  ]);
  return contextFor(attempt, interview, introduction, priorAttempts);
}

/** How much of each prior answer to carry over — enough for gist, not the lot. */
const PRIOR_ANSWER_CHARS = 300;
/** Safety cap on how many earlier attempts to fold in (retake limit is 3). */
const MAX_PRIOR_ATTEMPTS = 3;

/**
 * A digest of ALL this candidate's EARLIER completed attempts at the SAME
 * interview, oldest first so progression reads in order. Matched by partner
 * student id when present (how a retake is identified), falling back to email
 * for ordinary links. Null for first-timers. Best-effort: any failure just
 * means no prior context, never a broken interview.
 */
async function priorAttemptsContext(
  attempt: InterviewAttempt,
): Promise<string | null> {
  const studentId = attempt.externalStudentId?.trim() || null;
  const email = attempt.candidateEmail?.trim() || null;
  if (!studentId && !email) return null;

  // Same identity a retake is counted by, so the prior attempts are found.
  const sameCandidate = studentId
    ? eq(interviewAttemptsTable.externalStudentId, studentId)
    : eq(interviewAttemptsTable.candidateEmail, email!);

  try {
    const priors = await db.query.interviewAttemptsTable.findMany({
      where: and(
        sameCandidate,
        eq(interviewAttemptsTable.interviewId, attempt.interviewId),
        ne(interviewAttemptsTable.id, attempt.id),
        eq(interviewAttemptsTable.status, "completed"),
      ),
      orderBy: asc(interviewAttemptsTable.completedAt),
    });
    if (priors.length === 0) return null;
    // Defensive cap; keep the most recent ones if there are somehow more.
    const kept = priors.slice(-MAX_PRIOR_ATTEMPTS);

    // One query for every prior turn, then grouped per attempt.
    const turns = await db.query.interviewTurnsTable.findMany({
      where: and(
        inArray(
          interviewTurnsTable.attemptId,
          kept.map((p) => p.id),
        ),
        eq(interviewTurnsTable.kind, "skill"),
      ),
      orderBy: asc(interviewTurnsTable.turnNumber),
    });
    const turnsByAttempt = new Map<string, typeof turns>();
    for (const t of turns) {
      const list = turnsByAttempt.get(t.attemptId) ?? [];
      list.push(t);
      turnsByAttempt.set(t.attemptId, list);
    }

    const blocks = kept
      .map((prior, i) => {
        const lines = (turnsByAttempt.get(prior.id) ?? [])
          .filter((t) => t.answerTranscript?.trim())
          .map(
            (t) =>
              `Q: ${t.question}\nA: ${t
                .answerTranscript!.trim()
                .slice(0, PRIOR_ANSWER_CHARS)}`,
          );
        if (lines.length === 0) return null;
        const score =
          prior.overallScore !== null
            ? `overall ${prior.overallScore}/100`
            : "not scored";
        return [`Attempt ${i + 1} (${score}):`, ...lines].join("\n");
      })
      .filter((b): b is string => b !== null);

    return blocks.length > 0 ? blocks.join("\n\n") : null;
  } catch (error) {
    console.error(
      `[attempt] prior-attempts lookup failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return null;
  }
}

/**
 * The candidate's opening answer, used as context for every later question.
 * Read fresh each time rather than cached, so it is correct after a retry.
 */
async function introductionFor(attemptId: string): Promise<string | null> {
  const [attempt, probe] = await Promise.all([
    db.query.interviewAttemptsTable.findFirst({
      where: eq(interviewAttemptsTable.id, attemptId),
      columns: { candidateBackground: true },
    }),
    db.query.interviewTurnsTable.findFirst({
      where: and(
        eq(interviewTurnsTable.attemptId, attemptId),
        eq(interviewTurnsTable.kind, "language_probe"),
      ),
    }),
  ]);

  // Both when both exist. The typed background is available from the very
  // first question, before anything has been spoken or transcribed, which is
  // the whole reason it is collected up front; the spoken opener then adds
  // what they chose to say out loud. Neither replaces the other.
  const parts = [
    attempt?.candidateBackground?.trim(),
    probe?.answerTranscript?.trim(),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join("\n\n") : null;
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
 * Begin an attempt by creating the opening turn.
 *
 * The candidate has already chosen their language, so the opener is asked and
 * spoken in it from the first word. It still captures the introduction used to
 * ground later questions (kept under `kind: "language_probe"` so
 * `introductionFor` keeps working) — it is no longer a language probe.
 *
 * Idempotent: a refresh or double click returns the existing state rather than
 * creating a second turn. No OpenAI call — the opener is fixed per-language text.
 */
/** Everything this does, and everything it calls, is billed to the attempt. */
export function startAttempt(attemptId: string): Promise<void> {
  return withUsageScope(attemptId, () => startAttemptInner(attemptId));
}

async function startAttemptInner(attemptId: string): Promise<void> {
  const attempt = await reload(attemptId);
  const existing = await getTurns(attemptId);
  // Guard on the OPENER specifically, not "any turn" — the first question may
  // already have been prepared ahead by `prewarmFirstQuestion` while the
  // candidate was on the device-check screen, and that must not stop the
  // opener from being created here.
  const openerExists = existing.some(
    (turn) => turn.turnNumber === LANGUAGE_PROBE_TURN,
  );
  if (attempt.status !== "not_started" || openerExists) return;
  if (!attempt.language) {
    throw new AttemptError(
      "invalid_state",
      "No interview language was chosen for this attempt.",
    );
  }

  const language = resolveInterviewLanguage(attempt.language);
  const opening = OPENING_BY_KEY[language.key];

  const [claimed] = await db
    .update(interviewAttemptsTable)
    .set({
      status: "in_progress",
      currentQuestionNumber: LANGUAGE_PROBE_TURN,
      language: language.key,
      needsLanguageChoice: false,
      candidateCourse: about.course?.trim() || null,
      candidateExperience: about.experience?.trim() || null,
      // Composed as well as stored separately, so `introductionFor` and every
      // report that already reads this column keep working unchanged.
      candidateBackground: composeBackground(about) || null,
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

  // Another request won the race; it created the opener.
  if (!claimed) return;

  const opener = openerFor(language.key, firstNameOf(attempt.candidateName));

  await db.insert(interviewTurnsTable).values({
    attemptId,
    turnNumber: LANGUAGE_PROBE_TURN,
    kind: "language_probe",
    skillId: null,
    question: opening,
    status: "awaiting_answer",
  });

  await tryAttachQuestionAudio(
    attemptId,
    LANGUAGE_PROBE_TURN,
    opening,
    language.code,
  );
}

/**
 * Prepare the first real question WHILE the candidate is still on the device
 * check, so it is ready the instant they finish the opening turn.
 *
 * Grounded in the course they entered on the form — the intro answer does not
 * exist yet, so this one question trades intro-grounding for a zero-wait start;
 * every later question still uses the intro and prior answers. Best-effort: if
 * it fails, the question is simply generated the normal way when reached.
 */
export function prewarmFirstQuestion(
  attempt: InterviewAttempt,
  interview: Interview,
): Promise<void> {
  return withUsageScope(attempt.id, () =>
    prewarmFirstQuestionInner(attempt, interview),
  );
}

async function prewarmFirstQuestionInner(
  attempt: InterviewAttempt,
  interview: Interview,
): Promise<void> {
  if (!attempt.language || attempt.status !== "not_started") return;
  const existing = await getTurns(attempt.id);
  if (existing.length > 0) return; // already started or already prewarmed

  try {
    await generateAndInsertQuestion(
      attempt.id,
      interview,
      LANGUAGE_PROBE_TURN + 1,
    );
  } catch (error) {
    console.error(
      `[attempt] prewarm failed attempt=${attempt.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
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
  pace?: number,
): Promise<string | null> {
  try {
    const speech = await generateSpeech(text, { languageCode, pace });
    return await timed("r2.store.question", () =>
      storeAudio({
        attemptId,
        kind: "question",
        mimeType: speech.mimeType,
        data: speech.audio,
      }),
    );
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

export function regenerateQuestionAudio(
  attempt: InterviewAttempt,
  turnNumber: number,
): Promise<boolean> {
  return withUsageScope(attempt.id, () =>
    regenerateQuestionAudioInner(attempt, turnNumber),
  );
}

async function regenerateQuestionAudioInner(
  attempt: InterviewAttempt,
  turnNumber: number,
): Promise<boolean> {
  const turns = await getTurns(attempt.id);
  const turn = turns.find((t) => t.turnNumber === turnNumber);
  if (!turn || turn.questionAudioId) return Boolean(turn?.questionAudioId);

  const code = resolveInterviewLanguage(attempt.language ?? "english").code;

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

/**
 * Answer a doubt OUT LOUD, leaving the question exactly as it is.
 *
 * The candidate asked something instead of answering — "what does this word
 * mean?" — or said nothing usable. The interviewer speaks a short reply and the
 * on-screen question text never moves; the candidate answers it next. The reply
 * plays through the turn's audio slot, so a following "repeat" replays the
 * reply — acceptable, since the reply itself invites them to answer and the
 * question is still on screen. Falls back to a plain replay if the reply cannot
 * be generated or voiced.
 */
async function speakDoubtResponse(
  attempt: InterviewAttempt,
  turn: InterviewTurn,
  doubtTranscript: string,
): Promise<void> {
  const language = resolveInterviewLanguage(attempt.language ?? "english");

  let reply: string;
  try {
    reply = await generateDoubtResponse({
      // Reason from the English original where we have it — the local text may
      // itself be the word the candidate could not follow.
      question: turn.questionTranslation ?? turn.question,
      doubtTranscript,
      languageName: language.promptName,
      languageCode: language.code,
    });
  } catch (error) {
    console.error(
      `[attempt] doubt reply failed turn=${turn.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    await repeatTurn(attempt.id, turn.id);
    return;
  }

  const audioId = await synthesiseQuestionAudio(
    attempt.id,
    reply,
    language.code,
  );
  if (!audioId) {
    // No voice for the reply — fall back to replaying the question rather than
    // leave the candidate with a silent, unchanged screen.
    await repeatTurn(attempt.id, turn.id);
    return;
  }

  const previousAudioId = turn.questionAudioId;

  await db
    .update(interviewTurnsTable)
    .set({
      // Reply plays here; question / questionTranslation are left UNTOUCHED.
      questionAudioId: audioId,
      status: "awaiting_answer",
      errorMessage: null,
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turn.id));

  await db
    .update(interviewAttemptsTable)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  // The original question clip is now unreferenced.
  if (previousAudioId) await discardAudioClip(previousAudioId);
}

/**
 * Re-voice the CURRENT question slower, at the candidate's request.
 *
 * Same question text — only the audio changes (a lower TTS pace). Falls back to
 * a plain replay if the slow clip cannot be made.
 */
async function revoiceSlower(
  attempt: InterviewAttempt,
  turn: InterviewTurn,
): Promise<void> {
  const language = resolveInterviewLanguage(attempt.language ?? "english");
  const audioId = await synthesiseQuestionAudio(
    attempt.id,
    turn.question,
    language.code,
    0.7, // noticeably slower than the default 0.9
  );
  if (!audioId) {
    await repeatTurn(attempt.id, turn.id);
    return;
  }
  const previousAudioId = turn.questionAudioId;

  await db
    .update(interviewTurnsTable)
    .set({
      questionAudioId: audioId,
      status: "awaiting_answer",
      errorMessage: null,
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turn.id));

  await db
    .update(interviewAttemptsTable)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  if (previousAudioId) await discardAudioClip(previousAudioId);
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
  /**
   * Whether the browser's level meter heard an actual word in this recording.
   *
   * The deciding fact about whether an answer exists, and deliberately not the
   * transcriber's opinion. Handed near-silence, Sarvam returns fluent
   * plausible sentences — one interview ran eight questions deep on "Okay, so"
   * invented from an empty room, scoring every one of them and moving on each
   * time. The microphone cannot imagine a word; the model can.
   *
   * Absent on the recovery path, where there is no meter to ask — those fall
   * back to trusting the transcript, which is the old behaviour.
   */
  heardSpeech?: boolean;
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
 * The pieces are transcribed IN PARALLEL, not one after another — a long
 * answer is cut into ~25-second segments, and transcribing them serially made
 * the wait scale with how long the candidate spoke. Firing them together turns
 * that into roughly the time of a single segment; results are stitched back in
 * segment order regardless of which finished first.
 *
 * The language is FIXED — the candidate chose it up front — so every segment is
 * transcribed in it rather than letting Sarvam free-guess per segment. Locking
 * the language is also what stops the old silence-hallucination: told a language,
 * Sarvam no longer invents a stray phrase in a random script on a silent tail.
 */
async function transcribeSegments(
  answer: AnswerAudio,
  languageCode: string,
): Promise<string> {
  const settled = await Promise.all(
    answer.segments.map(async (segment) => {
      try {
        const result = await transcribeAudio({
          audio: segment,
          mimeType: answer.mimeType,
          languageCode,
        });
        return { ok: true as const, text: result.transcript?.trim() ?? "" };
      } catch (error) {
        // One bad slice must not lose the whole answer — a rollover can leave
        // a final fragment of a fraction of a second, which a transcriber
        // rejects.
        console.error(
          `[attempt] segment transcription failed: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        return { ok: false as const };
      }
    }),
  );

  const parts: string[] = [];
  let failures = 0;
  for (const result of settled) {
    if (!result.ok) {
      failures += 1;
      continue;
    }
    if (result.text) parts.push(result.text);
  }

  // Every slice failed: a real failure — say so rather than score an empty one.
  if (failures > 0 && parts.length === 0) {
    throw new ProviderError({
      provider: "sarvam",
      message: `all ${failures} answer segments failed to transcribe`,
      userMessage:
        "We could not transcribe your answer just now. Please try again.",
      retryable: true,
    });
  }

  return parts.join(" ");
}

/**
 * Non-repeat doubts raised per turn ("I don't know", "explain this"), so a
 * candidate who keeps saying they cannot answer is coaxed a couple of times
 * and then moved on, instead of being asked the same question forever.
 *
 * ponytail: in-process Map — per-instance and reset on restart, which is fine
 * (worst case is one extra re-ask after a redeploy). Promote to a turn column
 * only if it ever needs to survive across instances.
 */
const doubtCounts = new Map<string, number>();
const MAX_DOUBTS_BEFORE_SKIP = 1;

/**
 * Lowest score that may earn a follow-up. Deliberately 1, not higher: the whole
 * point of a probe is to give a THIN, LOW-scoring but genuine answer a fair
 * chance before that low score is settled (client ask — a fresher who says
 * "I've never spotted an error" must be PROBED, not handed a 1/10). Only a
 * literal 0 (nothing to work with) skips it; refusals / "I don't know" are
 * already filtered to the doubt path before scoring, and the model is told to
 * return no follow-up for empty/off-topic/refusal answers.
 */
const FOLLOWUP_MIN_SCORE = 1;

/**
 * Hard ceiling on follow-ups across the whole interview, so its length can't
 * balloon even when many answers are thin. Primaries are unaffected — every
 * skill is still asked — this only bounds the extra probes on top.
 */
const MAX_FOLLOWUPS_PER_INTERVIEW = 3;

/**
 * Floor on follow-ups per interview. Real freshers mostly give substantive
 * answers, so the thin-answer path almost never fires and interviews were
 * ending with ZERO probes. Once the remaining primary skills are down to
 * exactly the number of probes still owed, the follow-up decision is FORCED —
 * the model still writes the probe from what the candidate said; we only insist
 * one happens. Best-effort: an empty / skipped final answer can still slip it.
 */
const MIN_FOLLOWUPS_PER_INTERVIEW = 2;

/**
 * How short an answer must be to be worth pausing on.
 *
 * The follow-up decision is a model call on the critical path, so running it on
 * every answer taxes the whole interview with a pause. Instead we only reach
 * for it when the answer is genuinely THIN — a bare "yes", a couple of words —
 * which is exactly the case a probe is for. A substantive answer skips the call
 * entirely: advance instantly on the prefetched next question, score in the
 * background. Tunable — raise to probe more often, lower to probe less.
 */
const THIN_ANSWER_MAX_WORDS = 6;

function isThinAnswer(transcript: string): boolean {
  return (
    transcript.trim().split(/\s+/).filter(Boolean).length <=
    THIN_ANSWER_MAX_WORDS
  );
}

/**
 * Transcribe, score and move the interview on — billed to this attempt.
 *
 * The scope wraps the whole thing rather than each provider call, so anything
 * added underneath is counted without being told to.
 */
export function processTurn(
  attemptId: string,
  turnId: string,
  interview: Interview,
  answer?: AnswerAudio,
  providedTranscript?: string,
): Promise<void> {
  return withUsageScope(attemptId, () =>
    processTurnScoped(attemptId, turnId, interview, answer, providedTranscript),
  );
}

async function processTurnScoped(
  attemptId: string,
  turnId: string,
  interview: Interview,
  /**
   * The recording, when `processTurn` is called straight after the upload.
   * Absent when recovering a turn later, in which case it is read back from
   * storage instead — or when the transcript arrived from streaming STT.
   */
  answer?: AnswerAudio,
  /**
   * Transcript already produced by realtime streaming STT. When present, the
   * batch transcribe (and its silent-tail hallucination) is skipped entirely;
   * the video track still archives the answer separately.
   */
  providedTranscript?: string,
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
    // Language is fixed (chosen up front) and needed by both paths below.
    if (!attempt.language) {
      await failTurn(
        attemptId,
        turnId,
        "No interview language is set. Please start again.",
      );
      return;
    }
    const language = resolveInterviewLanguage(attempt.language);

    // --- 1. Get the transcript --------------------------------------------
    // Streaming path: Sarvam already returned it live, so there is nothing to
    // transcribe here. Audio path: transcribe in the FIXED interview language
    // (which also stops Sarvam hallucinating on silent tails), archiving the
    // audio alongside so the turn is only as long as the slower of the two.
    let transcript: string;
    if (providedTranscript != null) {
      transcript = providedTranscript.trim();
    } else {
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

      const [, heard] = await Promise.all([
        answer
          ? archiveAnswerAudio(attemptId, turnId, answer)
          : Promise.resolve(),
        transcribeSegments(audioRow, language.code),
      ]);
      transcript = heard;
    }

    console.log(
      `[attempt] heard turn=${turn.turnNumber} lang=${language.key} repeat=${isRepeatRequest(
        transcript,
      )} transcript=${JSON.stringify(transcript.slice(0, 160))}`,
    );

    const isProbe = turn.kind === "language_probe";

    // "Say it slower" — re-voice the same question at a lower pace.
    if (!isProbe && isSlowerRequest(transcript)) {
      await revoiceSlower(attempt, turn);
      return;
    }

    if (!transcript || transcript.trim().length < 2) {
      /**
       * A noise, but not words.
       *
       * The microphone heard something — this path is only reached when the
       * level meter said so — and the transcriber found nothing in it. That is
       * a cough, a sneeze, a cleared throat, a chair scraping. Asking "are you
       * okay?" is what a person in the room would do, and it is a far better
       * reply than re-reading the question at somebody who is spluttering.
       *
       * The question stays on screen and the microphone stays open, so they
       * simply carry on when they are ready.
       *
       * The probe still fails — with no words there is no language to detect.
       * ponytail: no cap here — somebody coughing into a hot mic gets asked
       * every time; add a counter if that ever bites.
       */
      if (isProbe && !attempt.language) {
        await failTurn(
          attemptId,
          turnId,
          "We could not hear an answer in that recording. Please check your microphone and record again.",
        );
        return;
      }

      const checkIn = await fillerAudioId(
        attemptId,
        "areYouOkay",
        turn.turnNumber + turn.directiveSeq,
      );
      if (checkIn) {
        await issueDirective(turnId, "play_filler", checkIn);
      } else {
        await repeatTurn(attemptId, turnId);
      }
      return;
    }

    // Is this a DOUBT raised instead of an answer — "say that again", "I didn't
    // understand", "what should I say?" — rather than an attempt at the
    // question? The phrase list catches the obvious ones instantly; for
    // anything subtler the model judges, so we respond and re-ask like a real
    // interviewer instead of scoring it as the answer. The opening turn is
    // never classified: its only job is to capture the introduction.
    const looksLikeRepeat = isRepeatRequest(transcript);
    const wantsSkip = !isProbe && isSkipRequest(transcript);
    const isDoubt =
      looksLikeRepeat ||
      wantsSkip ||
      (!isProbe &&
        (await classifyUtterance({
          question: turn.question,
          transcript,
          languageName: attempt.language
            ? resolveInterviewLanguage(attempt.language).promptName
            : "English",
        })) === "doubt");

    if (isDoubt) {
      // The question text NEVER changes — the one first shown stays until it is
      // actually answered. What differs is the interviewer's spoken response:
      //   - an explicit "repeat" (or the probe) just replays the exact question;
      //   - a skip, "I don't know", or any other doubt gets ONE spoken nudge to
      //     try, and if they still don't answer, we move on. No endless loop.
      if (looksLikeRepeat || isProbe || !attempt.language) {
        // A plain "say it again" (or the probe, which cannot be skipped) just
        // replays. These do not count as giving up.
        await repeatTurn(attemptId, turnId);
      } else {
        // Skip / "I don't know" / "I can't answer": encourage them to try ONCE,
        // then move on. The candidate asked not to be badgered 3+ times.
        const key = `${attemptId}:${turn.turnNumber}`;
        const seen = (doubtCounts.get(key) ?? 0) + 1;
        doubtCounts.set(key, seen);
        if (seen > MAX_DOUBTS_BEFORE_SKIP) {
          doubtCounts.delete(key);
          await skipTurn(attempt, interview, turn.turnNumber);
        } else {
          await speakDoubtResponse(attempt, turn, transcript);
        }
      }
      return;
    }

    if (isProbe) {
      await completeProbe({ attempt, interview, turnId, transcript });
      return;
    }

    // Language is fixed for the whole interview (chosen up front), so there is
    // no detection or switching — the answer is scored and we move on.
    await handleAnsweredTurn({
      attempt,
      interview,
      turn,
      transcript,
      languageCode: language.code,
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
 * Finish the opening turn.
 *
 * The language is already fixed (chosen up front), so this just records the
 * candidate's introduction and delivers the first real question.
 */
async function completeProbe(args: {
  attempt: InterviewAttempt;
  interview: Interview;
  turnId: string;
  transcript: string;
}): Promise<void> {
  const { attempt, interview, turnId, transcript } = args;

  await db
    .update(interviewTurnsTable)
    .set({
      answerTranscript: transcript,
      status: "completed",
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turnId));

  await deliverTurn(attempt.id, interview, LANGUAGE_PROBE_TURN + 1);
}

/* -------------------------------------------------------------------------- */
/*                           Question preparation                             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                                 Directives                                 */
/* -------------------------------------------------------------------------- */

/**
 * One instruction for the browser: play this, then do that.
 *
 * The interview used to signal a replay implicitly — same turn number, status
 * back to `awaiting_answer` — and the browser inferred the rest. That worked
 * while replaying the question was the only thing the server could ask for. It
 * cannot express "play the simpler wording", "play a follow-up probe" or "say
 * a short acknowledgement", because all of those leave the turn number and the
 * status exactly where they were.
 *
 * So the instruction is explicit, and `seq` is what makes it safe: the browser
 * polls once a second and will see the same directive many times, so it acts
 * when the number changes rather than when the shape looks new.
 */
export interface TurnDirective {
  seq: number;
  action: "replay" | "play_easier" | "play_probe" | "play_filler" | "advance";
  /** Clip to play. Null means there is nothing to say, only something to do. */
  audioId: string | null;
  /** 1.0 normally; lower after the candidate has asked for it slower. */
  speechRate: number;
  /** Whether to start recording again once the clip has finished. */
  resumeRecording: boolean;
}

/**
 * Tell the browser to do something, and make sure it notices.
 *
 * Bumping `directiveSeq` in SQL rather than reading and writing it keeps two
 * concurrent branches — a silence timer and a submitted answer arriving at
 * once — from issuing the same number twice, which would make the second
 * instruction invisible.
 */
async function issueDirective(
  turnId: string,
  action: TurnDirective["action"],
  audioId: string | null,
): Promise<void> {
  await db
    .update(interviewTurnsTable)
    .set({
      directiveAction: action,
      directiveAudioId: audioId,
      directiveSeq: sql`${interviewTurnsTable.directiveSeq} + 1`,
      status: action === "advance" ? "completed" : "awaiting_answer",
      processingStartedAt: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turnId));
}

/**
 * The clip for one of a turn's prepared variants, falling back sensibly.
 *
 * Never returns nothing when something exists: an unvoiced or failed variant
 * falls back to the question's own clip, because hearing the question again is
 * far better than hearing silence. Null only when the turn itself has no
 * audio, which the browser already handles by showing the text and a retry.
 */
async function variantAudioId(
  attemptId: string,
  planIndex: number | null,
  role: "primary" | "easier" | "probe",
  ordinal: number,
  fallbackAudioId: string | null,
): Promise<string | null> {
  if (planIndex === null) return fallbackAudioId;

  const variant = await db.query.interviewTurnVariantsTable.findFirst({
    where: and(
      eq(interviewTurnVariantsTable.attemptId, attemptId),
      eq(interviewTurnVariantsTable.planIndex, planIndex),
      eq(interviewTurnVariantsTable.role, role),
      eq(interviewTurnVariantsTable.ordinal, ordinal),
    ),
  });

  if (variant?.audioStatus === "ready" && variant.audioId) {
    return variant.audioId;
  }
  return fallbackAudioId;
}

/* -------------------------------------------------------------------------- */
/*                          Preparing the interview                           */
/* -------------------------------------------------------------------------- */

/**
 * Run work in the background without letting it take the caller down with it.
 *
 * `after()` is the right tool inside a request — it keeps the work within the
 * server's lifetime and the platform waits for it — but it THROWS when there
 * is no request scope, and it is called from deep in this service, which also
 * runs from scripts, jobs and tests. Left bare, a background nicety takes out
 * the thing it was decorating: preparation failing to schedule would stop an
 * interview from starting at all.
 *
 * So: use `after` when it is available, fall back to a detached promise when
 * it is not. The container is long-lived (a standalone Next server, not a
 * function that freezes between requests), so a detached promise still runs to
 * completion.
 *
 * The work itself is wrapped too. Every caller here is doing something
 * optional — writing questions ahead of time — and none of it should surface
 * to a candidate as an error.
 */
function scheduleBackground(label: string, work: () => Promise<void>): void {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      console.error(
        `[attempt] background ${label} failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  };

  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * How many warm-up questions follow the fixed opener.
 *
 * The opener is itself a comfort question — fixed text, already voiced, so it
 * costs nothing — which makes three easy questions in total before anything is
 * scored. Enough for a nervous candidate to hear their own voice and discover
 * that nothing bad happens.
 */
const COMFORT_QUESTION_COUNT = 2;

/**
 * How much slower "say it slowly" makes the interviewer.
 *
 * Applied in the browser with `playbackRate`, so it reaches clips that were
 * voiced before the candidate asked. Not lower than this: the voice is already
 * synthesised at its natural pace, and stacking a heavy slowdown on top makes
 * it sound drugged rather than clear.
 */
const SLOWER_SPEECH_RATE = 0.85;

/**
 * How many prepared follow-ups one question may spend.
 *
 * Two. A third is the point at which digging stops being interest and
 * starts being interrogation, and there are only two probes written per
 * question anyway.
 */
const MAX_FOLLOW_UPS = 2;

/**
 * Which skills each wave writes.
 *
 * Not one big batch. Preparing all ten up front means paying for the whole
 * interview including the ones abandoned at question three — which
 * `sweepAbandonedAttempts` exists because they are. Each wave fits a single
 * provider call comfortably and lands while the candidate is still answering
 * the questions before it.
 */
const SKILL_WAVES: number[][] = [
  [0, 1, 2],
  [3, 4, 5, 6],
  [7, 8, 9],
];

/**
 * Where a skill sits in the plan.
 *
 * Plan 1 is the fixed opener, 2..(1 + COMFORT_QUESTION_COUNT) are the prepared
 * warm-ups, and the skills follow in framework order.
 */
function planIndexForSkill(skillIndex: number): number {
  return 1 + COMFORT_QUESTION_COUNT + 1 + skillIndex;
}

/**
 * Write one batch of prepared questions and their variants.
 *
 * Idempotent per plan position: the unique index on
 * (attemptId, planIndex, role, ordinal) means a wave that runs twice — a retry,
 * or two requests racing — inserts nothing the second time rather than
 * doubling the interview.
 */
async function storePreparedQuestions(
  attemptId: string,
  prepared: PreparedQuestion[],
  planIndexOf: (index: number) => number,
): Promise<void> {
  const rows: (typeof interviewTurnVariantsTable.$inferInsert)[] = [];

  prepared.forEach((row, index) => {
    const planIndex = planIndexOf(index);
    rows.push({
      attemptId,
      planIndex,
      role: "primary",
      ordinal: 0,
      text: row.question,
      translation: row.translation,
    });
    rows.push({
      attemptId,
      planIndex,
      role: "easier",
      ordinal: 0,
      text: row.easier,
      translation: row.easierTranslation,
    });
    row.probes.forEach((probe, probeIndex) => {
      rows.push({
        attemptId,
        planIndex,
        role: "probe",
        ordinal: probeIndex,
        text: probe.text,
        translation: probe.translation,
      });
    });
  });

  if (rows.length === 0) return;
  await db
    .insert(interviewTurnVariantsTable)
    .values(rows)
    .onConflictDoNothing();
}

/**
 * Plan index reserved for the fixed lines.
 *
 * Zero, because they belong to the attempt rather than to any question: the
 * same "okay" serves every turn. Filing them here means the voicing backfill
 * and the missing-clip fallback both work on them unchanged.
 */
const FILLER_PLAN_INDEX = 0;

/**
 * Write every fixed line the interview might say.
 *
 * All of them, up front, on the first wave. They are short — the whole set is
 * about the length of two questions — and needing one is always urgent: an
 * "okay" that arrives after the silence it was meant to cover is worse than no
 * "okay" at all.
 */
async function storeFillers(
  attemptId: string,
  language: InterviewLanguageKey,
  /** Filled into the lines that address the candidate — see `{name}`. */
  name: string | null,
): Promise<void> {
  const rows: (typeof interviewTurnVariantsTable.$inferInsert)[] = [];

  for (const [kind, options] of Object.entries(FILLERS[language])) {
    options.forEach((text, index) => {
      rows.push({
        attemptId,
        planIndex: FILLER_PLAN_INDEX,
        role: "filler",
        ordinal: index,
        slug: kind,
        // Checking on someone by name is the whole point of the line; the
        // space goes with the slot when there is no name to put in it.
        text: name
          ? text.replace("{name}", name)
          : text.replace("{name}, ", "").replace(" {name}", ""),
      });
    });
  }

  if (rows.length === 0) return;
  await db
    .insert(interviewTurnVariantsTable)
    .values(rows)
    .onConflictDoNothing();
}

/**
 * Say all the fixed lines again, in the language just chosen.
 *
 * They are written once, at the start, in whatever language the interview
 * opened in — so without this a candidate who switches to Hindi keeps being
 * asked "is everything alright?" and "did you not follow the question?" in
 * English. Those lines exist to reassure somebody who is struggling, and
 * arriving in the language they just told us they cannot follow is the worst
 * possible moment to get it wrong.
 *
 * The old rows go, along with their clips: they are attempt-scoped and nothing
 * will ever point at them again, so leaving them behind is storage paid for
 * and never read. Discarding runs in the background because the candidate is
 * waiting on the switch and a bucket delete is not their problem.
 */
async function refreshFillersForLanguage(
  attemptId: string,
  language: InterviewLanguage & { key: InterviewLanguageKey },
  name: string | null,
): Promise<void> {
  const stale = await db.query.interviewTurnVariantsTable.findMany({
    where: and(
      eq(interviewTurnVariantsTable.attemptId, attemptId),
      eq(interviewTurnVariantsTable.role, "filler"),
    ),
    columns: { audioId: true },
  });

  await db
    .delete(interviewTurnVariantsTable)
    .where(
      and(
        eq(interviewTurnVariantsTable.attemptId, attemptId),
        eq(interviewTurnVariantsTable.role, "filler"),
      ),
    );

  await storeFillers(attemptId, language.key, name);
  await voicePendingVariants(attemptId, language.code);

  scheduleBackground(`discard old fillers for ${attemptId}`, async () => {
    for (const row of stale) {
      if (row.audioId) await discardAudioClip(row.audioId);
    }
  });
}

/**
 * The clip for a fixed line, varied so it is not the same syllable every time.
 *
 * `seed` is something that already differs per turn, so a candidate hears
 * "okay", then "right", then "got it" rather than the same word eleven times —
 * which is precisely what made the previous acknowledgement sound mechanical.
 */
async function fillerAudioId(
  attemptId: string,
  kind: FillerKind,
  seed: number,
): Promise<string | null> {
  const ready = await db.query.interviewTurnVariantsTable.findMany({
    where: and(
      eq(interviewTurnVariantsTable.attemptId, attemptId),
      eq(interviewTurnVariantsTable.role, "filler"),
      eq(interviewTurnVariantsTable.slug, kind),
      eq(interviewTurnVariantsTable.audioStatus, "ready"),
    ),
    orderBy: asc(interviewTurnVariantsTable.ordinal),
  });
  if (ready.length === 0) return null;
  return ready[Math.abs(seed) % ready.length]?.audioId ?? null;
}

/**
 * The "okay" said the moment an answer ends.
 *
 * Handed back with the upload receipt rather than with the next question,
 * because the point of it is the gap in between. A candidate who stops talking
 * into silence cannot tell whether they were heard; the client complaint that
 * the interviewer "takes a lot of time thinking" was mostly this — the waiting
 * was audible as nothing at all.
 */
export async function acknowledgementClip(
  attemptId: string,
  seed: number,
): Promise<string | null> {
  return fillerAudioId(attemptId, "okay", seed);
}

/**
 * Voice everything written but not yet spoken.
 *
 * Six at a time. The TTS timeout is short and does not retry, so a wider fan
 * turns a rate-limit burst into lost clips rather than queued ones; six was
 * measured at about a second for six clips, fast enough that the backlog never
 * gets ahead of the candidate.
 *
 * The order is not incidental: the simpler wording of a question is needed at
 * that question's own silence prompt, so it must not sit behind the follow-up
 * probes of a question four turns later.
 */
async function voicePendingVariants(
  attemptId: string,
  languageCode: string,
): Promise<void> {
  const ROLE_PRIORITY: Record<string, number> = {
    primary: 0,
    easier: 1,
    probe: 2,
  };

  const pending = await db.query.interviewTurnVariantsTable.findMany({
    where: and(
      eq(interviewTurnVariantsTable.attemptId, attemptId),
      eq(interviewTurnVariantsTable.audioStatus, "pending"),
    ),
  });
  if (pending.length === 0) return;

  pending.sort(
    (a, b) =>
      a.planIndex - b.planIndex ||
      (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9) ||
      a.ordinal - b.ordinal,
  );

  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const variant = pending[cursor++];
      if (!variant) return;
      const audioId = await synthesiseQuestionAudio(
        attemptId,
        variant.text,
        languageCode,
      );
      await db
        .update(interviewTurnVariantsTable)
        .set({
          audioId,
          // A failure is recorded rather than retried forever: delivery falls
          // back to the question's own clip, and hearing the question again
          // beats hearing silence.
          audioStatus: audioId ? "ready" : "failed",
          updatedAt: new Date(),
        })
        .where(eq(interviewTurnVariantsTable.id, variant.id));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker),
  );
}

/**
 * Write and voice one wave of the interview.
 *
 * Waves are triggered by progress rather than by a clock: the first goes out
 * while the candidate is still hearing the opener, and each later one while
 * they are answering a question several turns before it is needed.
 *
 * Best-effort throughout. A wave that fails leaves `preparationStatus` at
 * `failed`, and delivery falls back to writing that one question on demand —
 * slower for that turn, but an interview that continues.
 */
async function prepareWave(
  attemptId: string,
  interview: Interview,
  waveIndex: number,
): Promise<void> {
  const attempt = await reload(attemptId);
  if (!attempt.language) return;

  const language = resolveInterviewLanguage(attempt.language);
  const existing = await db.query.interviewTurnVariantsTable.findMany({
    where: eq(interviewTurnVariantsTable.attemptId, attemptId),
    columns: { planIndex: true },
  });
  const done = new Set(existing.map((v) => v.planIndex));

  const ctx = contextFor(attempt, interview, await introductionFor(attemptId));
  const priorTurns = await getTurns(attemptId);

  try {
    if (waveIndex === 0) {
      // The fixed lines first: they are needed from the very first answer,
      // and they are cheap enough that ordering them ahead of the questions
      // costs nothing measurable.
      await storeFillers(
        attemptId,
        language.key,
        firstNameOf(attempt.candidateName),
      );

      const comfortPlans = Array.from(
        { length: COMFORT_QUESTION_COUNT },
        (_, i) => i + 2,
      );
      if (!comfortPlans.every((plan) => done.has(plan))) {
        const comfort = await prepareQuestions({
          ctx,
          skills: [],
          comfortCount: COMFORT_QUESTION_COUNT,
          history: toHistory(priorTurns),
        });
        await storePreparedQuestions(
          attemptId,
          comfort.slice(0, COMFORT_QUESTION_COUNT),
          (index) => index + 2,
        );
      }
    }

    const band = SKILL_WAVES[waveIndex];
    if (band && !band.every((i) => done.has(planIndexForSkill(i)))) {
      const skills = band.map((i) => WORK_SKILLS[i]!);
      const questions = await prepareQuestions({
        ctx,
        skills,
        history: toHistory(priorTurns),
      });
      await storePreparedQuestions(attemptId, questions, (index) =>
        planIndexForSkill(band[index] ?? 0),
      );
    }

    await db
      .update(interviewAttemptsTable)
      .set({ preparationStatus: "questions_ready", updatedAt: new Date() })
      .where(eq(interviewAttemptsTable.id, attemptId));

    await voicePendingVariants(attemptId, language.code);

    await db
      .update(interviewAttemptsTable)
      .set({ preparationStatus: "audio_ready", updatedAt: new Date() })
      .where(eq(interviewAttemptsTable.id, attemptId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(
      `[attempt] preparation wave ${waveIndex} failed for ${attemptId}: ${message}`,
    );
    await db
      .update(interviewAttemptsTable)
      .set({
        preparationStatus: "failed",
        preparationError: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(interviewAttemptsTable.id, attemptId));
  }
}

/** The primary (non-follow-up) skill turns asked so far. */
function primaryTurns(turns: InterviewTurn[]): InterviewTurn[] {
  return turns.filter((t) => t.kind === "skill" && !t.isFollowUp);
}

/**
 * The next primary skill to ask, or null when all ten have been covered.
 *
 * Data-driven rather than derived from the turn number: dynamic follow-ups mean
 * turn numbers no longer map one-to-one onto skills, so the schedule is read
 * from how many primary questions have actually been asked.
 */
function nextPrimarySkill(priorTurns: InterviewTurn[]): WorkSkill | null {
  const asked = primaryTurns(priorTurns).length;
  return asked < WORK_SKILL_COUNT ? WORK_SKILLS[asked]! : null;
}

/**
 * Whether the turn the candidate just answered was the last skill.
 *
 * The look-ahead prefetches the NEXT primary question — inserting a real turn
 * row — while the candidate is still on the current one. So `getTurns()` already
 * contains a skill turn that has NOT been delivered yet, and counting it made
 * the interview finish one skill early: the prefetched last skill (customer
 * orientation) was inserted, counted as "asked", then never shown. Count only
 * turns up to and including the one just answered, so a prefetched-ahead turn is
 * still delivered rather than mistaken for an already-covered skill.
 */
function isLastSkillTurn(
  turns: InterviewTurn[],
  answeredTurnNumber: number,
): boolean {
  const delivered = turns.filter((t) => t.turnNumber <= answeredTurnNumber);
  return !nextPrimarySkill(delivered);
}

/** 1-based position of a skill in the fixed framework order. */
function skillNumberOf(skillId: WorkSkillId): number {
  return WORK_SKILL_IDS.indexOf(skillId) + 1;
}

/**
 * Pick a Work Readiness question from the fixed pool for this interview.
 *
 * Hindi and Marathi use the client-finalised text verbatim (with the English
 * kept as the reviewer translation); English uses the English; every other
 * language renders the English seed live. This is the only skill that skips
 * the model for its wording.
 */
async function pickReadinessQuestion(
  ctx: InterviewContext,
  languageKey: string | null,
): Promise<{ question: string; translation: string | null }> {
  const q =
    WORK_READINESS_QUESTIONS[
      Math.floor(Math.random() * WORK_READINESS_QUESTIONS.length)
    ]!;
  if (languageKey === "hindi") return { question: q.hi, translation: q.en };
  if (languageKey === "marathi") return { question: q.mr, translation: q.en };
  if (languageKey === "english" || !languageKey)
    return { question: q.en, translation: null };
  // Telugu, Tamil, etc. — render the English seed in the interview language.
  return translateQuestion(ctx, q.en);
}

async function generateAndInsertQuestion(
  attemptId: string,
  interview: Interview,
  turnNumber: number,
): Promise<void> {
  const attempt = await reload(attemptId);

  const priorTurns = await db.query.interviewTurnsTable.findMany({
    where: and(
      eq(interviewTurnsTable.attemptId, attemptId),
      lt(interviewTurnsTable.turnNumber, turnNumber),
    ),
    orderBy: asc(interviewTurnsTable.turnNumber),
  });

  // A prepared turn is always a PRIMARY question — follow-ups are inserted
  // straight from the answer, never prepared ahead.
  const skill = nextPrimarySkill(priorTurns);
  if (!skill) return;

  const ctx = await buildContext(attempt, interview);
  // Work readiness comes from a FIXED per-language pool (never AI-invented):
  // pick one at random, using the stored Hindi/Marathi text as-is and rendering
  // the English live for other languages. Every other skill is AI-generated.
  const generated =
    skill.id === "work_readiness"
      ? await pickReadinessQuestion(ctx, attempt.language)
      : await generateQuestion({
          ctx,
          skill,
          turnNumber: skillNumberOf(skill.id),
          history: toHistory(priorTurns),
        });

  // Voiced before the turn is written, so it is never current without audio.
  const questionAudioId = await synthesiseQuestionAudio(
    attemptId,
    generated.question,
    ctx.language.code,
  );

  // A switch may have landed while this was being written and voiced. The
  // question in hand is in the old language, and the discard that cleared
  // the other prepared turns ran before this one existed — so check the
  // language again here rather than reinstating what was just thrown away.
  const current = await reload(attemptId);
  if (current.language !== attempt.language) {
    if (questionAudioId) await discardAudioClip(questionAudioId);
    return;
  }

  const [inserted] = await db
    .insert(interviewTurnsTable)
    .values({
      attemptId,
      turnNumber,
      kind: "skill",
      skillId: skill.id,
      isFollowUp: false,
      // Filed under the plan entry it stands in for, so the simpler wording
      // and probes a wave DID manage to write are still reachable from it.
      planIndex: planIndexForSkill(skillNumberOf(skill.id) - 1),
      question: generated.question,
      questionTranslation: generated.translation,
      questionAudioId,
      status: "awaiting_answer",
    })
    .onConflictDoNothing()
    .returning({ id: interviewTurnsTable.id });

  // Another instance got there first. The clip we just made belongs to a
  // turn that will never exist, so take it back out rather than leave it
  // billed and unreferenced.
  if (!inserted && questionAudioId) {
    await discardAudioClip(questionAudioId);
  }
}

/** Delete a stored clip and its row. Best-effort; never throws. */
async function discardAudioClip(audioId: string): Promise<void> {
  try {
    const clip = await db.query.interviewAudioTable.findFirst({
      where: eq(interviewAudioTable.id, audioId),
    });
    if (!clip) return;
    await deleteAudioObject(clip.storageKey);
    await db
      .delete(interviewAudioTable)
      .where(eq(interviewAudioTable.id, audioId));
  } catch (error) {
    console.error(
      `[attempt] could not discard audio ${audioId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

/**
 * Make a question current.
 *
 * Only non-follow-up questions can be prepared ahead — a follow-up has to be
 * built from an answer that does not exist yet. Best-effort: if it fails, the
 * question is simply generated the normal way when the answer arrives.
 */
async function prefetchNextQuestion(
  attemptId: string,
  interview: Interview,
  currentTurnNumber: number,
): Promise<void> {
  const turns = await getTurns(attemptId);

  // Prepare the next primary ahead of time after EVERY turn, so the common case
  // (a substantive answer that needs no follow-up) advances with the next
  // question already in hand — no on-demand generation, no pause. On the rare
  // thin answer that does earn a follow-up, `deliverFollowUp` reclaims this
  // slot (see there).
  //
  // Nothing left to prepare once every skill has its primary question.
  if (!nextPrimarySkill(turns)) return;

  const nextTurnNumber = currentTurnNumber + 1;
  if (turns.some((t) => t.turnNumber === nextTurnNumber)) return;

  try {
    await buildAndInsertQuestion(attemptId, interview, nextTurnNumber);
  } catch (error) {
    console.error(
      `[attempt] prefetch failed attempt=${attemptId} turn=${nextTurnNumber}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

/**
 * Make a question current — generating it first only if it was not already
 * prepared — then look ahead and start preparing the one after it.
 */
async function deliverTurn(
  attemptId: string,
  interview: Interview,
  turnNumber: number,
): Promise<void> {
  const turns = await getTurns(attemptId);
  if (!turns.some((t) => t.turnNumber === turnNumber)) {
    if (!nextPrimarySkill(turns)) return;
    await generateAndInsertQuestion(attemptId, interview, turnNumber);
  }

  await db
    .update(interviewAttemptsTable)
    .set({
      status: "in_progress",
      currentQuestionNumber: turnNumber,
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attemptId));

  // Top up the plan well before it runs out. Keyed on how many skill
  // questions have actually been asked rather than the turn number, because a
  // follow-up shifts turn numbers but does not advance the plan.
  const asked = primaryTurns(turns).length;
  const nextWave = SKILL_WAVES.findIndex(
    (band) => band.length > 0 && asked < (band[0] ?? 0) + 1,
  );

  // A next primary may have been prefetched into this slot while the candidate
  // answered. The follow-up takes it: drop that prepared turn (and its clip)
  // first, and overwrite on the off chance a prefetch lands in the same instant
  // — so the follow-up always wins, never a silent no-op that leaves the
  // primary in place.
  const prepared = await db.query.interviewTurnsTable.findFirst({
    where: and(
      eq(interviewTurnsTable.attemptId, attempt.id),
      eq(interviewTurnsTable.turnNumber, nextTurnNumber),
    ),
  });
  if (prepared) {
    if (prepared.questionAudioId) await discardAudioClip(prepared.questionAudioId);
    await db
      .delete(interviewTurnsTable)
      .where(eq(interviewTurnsTable.id, prepared.id));
  }

  const followUpValues = {
    kind: "skill" as const,
    skillId: currentTurn.skillId,
    isFollowUp: true,
    question: followUpQuestion,
    questionTranslation: followUpTranslation,
    questionAudioId,
    status: "awaiting_answer" as const,
  };
  await db
    .insert(interviewTurnsTable)
    .values({
      attemptId: attempt.id,
      turnNumber: nextTurnNumber,
      ...followUpValues,
    })
    .onConflictDoUpdate({
      target: [interviewTurnsTable.attemptId, interviewTurnsTable.turnNumber],
      set: followUpValues,
    });

  await db
    .update(interviewAttemptsTable)
    .set({
      status: "in_progress",
      currentQuestionNumber: nextTurnNumber,
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  await prefetchNextQuestion(attempt.id, interview, nextTurnNumber);
}

/* -------------------------------------------------------------------------- */
/*                             Answer processing                              */
/* -------------------------------------------------------------------------- */

/**
 * Score one answered skill turn against its skill. No next question is asked
 * here — that is prepared separately — so this can safely run in the
 * background after the candidate has already moved on.
 */
async function scoreTurn(args: {
  attempt: InterviewAttempt;
  interview: Interview;
  turn: InterviewTurn;
  transcript: string;
  languageCode: string | null;
}): Promise<void> {
  const { attempt, interview, turn, transcript, languageCode } = args;
  const ctx = await buildContext(attempt, interview);

  const priorTurns = await db.query.interviewTurnsTable.findMany({
    where: and(
      eq(interviewTurnsTable.attemptId, attempt.id),
      lt(interviewTurnsTable.turnNumber, turn.turnNumber),
    ),
    orderBy: asc(interviewTurnsTable.turnNumber),
  });

  // Scored in isolation: the next question comes from the look-ahead
  // pipeline, so no tokens are spent on one here. `scoreOnly` rather than a
  // null skill — a null skill used to read as "this was the last question",
  // which framed every mid-interview answer as a closing one.
  const evaluation = await evaluateAnswerAndGetNextQuestion({
    ctx,
    history: toHistory(priorTurns),
    currentSkill: getWorkSkill(turn.skillId as WorkSkillId),
    currentQuestion: turn.question,
    answerTranscript: transcript,
    turnNumber: skillNumberOf(turn.skillId as WorkSkillId),
    nextSkill: null,
    nextIsFollowUp: false,
    scoreOnly: true,
  });

  await writeScoredTurn(turn.id, transcript, languageCode, evaluation);
}

/**
 * Scoring that is still running, per attempt.
 *
 * An ordinary turn is scored in the background after the candidate has been
 * moved on. Answer the next question quickly enough and the report can be
 * written while the previous answer is still being marked — the score lands
 * after `aggregateSkillScores` has already read the turns, so that skill
 * reads as unassessed in a finished report.
 *
 * `finaliseAttempt` waits on these first.
 */
const scoringInFlight = new Map<string, Set<Promise<unknown>>>();

function trackScoring(attemptId: string, work: Promise<unknown>): void {
  const pending = scoringInFlight.get(attemptId) ?? new Set();
  pending.add(work);
  scoringInFlight.set(attemptId, pending);

  void work.finally(() => {
    pending.delete(work);
    if (pending.size === 0) scoringInFlight.delete(attemptId);
  });
}

/** Wait for any outstanding scoring for this attempt to land. */
async function settleScoring(attemptId: string): Promise<void> {
  const pending = scoringInFlight.get(attemptId);
  if (!pending || pending.size === 0) return;
  await Promise.allSettled([...pending]);
}

/** Write a computed score onto an answered turn (no model call). */
async function writeScoredTurn(
  turnId: string,
  transcript: string,
  languageCode: string | null,
  evaluation: {
    score: number;
    evaluation: string;
    strengths: string[];
    improvements: string[];
    concern?: "none" | "off_topic" | "inappropriate";
  },
): Promise<void> {
  await db
    .update(interviewTurnsTable)
    .set({
      answerTranscript: transcript,
      detectedLanguageCode: languageCode,
      score: evaluation.score,
      evaluation: evaluation.evaluation,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      // Absent means none — see the note on the field in `openai.ts`.
      concern: evaluation.concern ?? "none",
      status: "completed",
      errorMessage: null,
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turnId));
}

/** Move to the next primary skill, or finish the interview if none remain. */
async function advanceOrFinish(
  attempt: InterviewAttempt,
  interview: Interview,
  turn: InterviewTurn,
): Promise<void> {
  const turns = await getTurns(attempt.id);
  if (isLastSkillTurn(turns, turn.turnNumber)) {
    await settleScoring(attempt.id);
    await finaliseAttempt(attempt.id, interview);
    return;
  }
  await deliverTurn(attempt.id, interview, turn.turnNumber + 1);
}

/**
 * Skip the current question at the candidate's request.
 *
 * Marked completed but UNSCORED — skipping is not penalised (see the scoring
 * note): the skill simply reads as unassessed, like one never reached. Then we
 * move on exactly as a real answer would.
 */
export function skipTurn(
  attempt: InterviewAttempt,
  interview: Interview,
  turnNumber: number,
): Promise<void> {
  return withUsageScope(attempt.id, () =>
    skipTurnInner(attempt, interview, turnNumber),
  );
}

async function skipTurnInner(
  attempt: InterviewAttempt,
  interview: Interview,
  turnNumber: number,
): Promise<void> {
  const turn = (await getTurns(attempt.id)).find(
    (t) => t.turnNumber === turnNumber,
  );
  if (!turn || turn.status === "completed") return;

  await db
    .update(interviewTurnsTable)
    .set({
      status: "completed",
      answerTranscript: turn.answerTranscript ?? "(skipped)",
      evaluation: "The candidate chose to skip this question.",
      score: null,
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turn.id));

  await advanceOrFinish(attempt, interview, turn);
}

/**
 * What happens once a skill answer has been transcribed.
 *
 * Two paths. For a follow-up-ELIGIBLE primary the model must see the answer to
 * decide whether to dig deeper, so scoring and that decision happen together on
 * the critical path — the deliberate cost of a follow-up. For everything else
 * (an ineligible primary, or a follow-up answer) the next question is already
 * prepared, so we advance FIRST and score in the background. The final turn is
 * always scored before the report is written.
 */
async function handleAnsweredTurn(args: {
  attempt: InterviewAttempt;
  interview: Interview;
  turn: InterviewTurn;
  transcript: string;
  languageCode: string | null;
}): Promise<void> {
  const { attempt, interview, turn, languageCode } = args;

  const skillId = turn.skillId as WorkSkillId | null;
  const priorTurns = await db.query.interviewTurnsTable.findMany({
    where: and(
      eq(interviewTurnsTable.attemptId, attempt.id),
      lt(interviewTurnsTable.turnNumber, turn.turnNumber),
    ),
    orderBy: asc(interviewTurnsTable.turnNumber),
  });
  const followUpsSoFar = priorTurns.filter((t) => t.isFollowUp).length;

  // A follow-up runs the decision on the critical path (it has to see the
  // answer), so we don't do it on every turn. Two triggers:
  //  - the answer is THIN — a bare / one-word reply a probe is actually for;
  //  - the FLOOR is at risk — the remaining primary skills are down to exactly
  //    the number of probes still owed, so this one is forced to guarantee the
  //    minimum (see MIN_FOLLOWUPS_PER_INTERVIEW). AI still writes the probe.
  // Everything else takes the fast path: advance on the prefetched next
  // question and score in the background, with no model call between questions.
  const primariesBefore = primaryTurns(priorTurns).length;
  const followUpsOwed = MIN_FOLLOWUPS_PER_INTERVIEW - followUpsSoFar;
  const remainingPrimaries = WORK_SKILL_COUNT - primariesBefore; // incl. this turn
  const underCap = followUpsSoFar < MAX_FOLLOWUPS_PER_INTERVIEW;
  const mustFollowUp =
    !turn.isFollowUp &&
    !!skillId &&
    underCap &&
    followUpsOwed > 0 &&
    remainingPrimaries <= followUpsOwed;
  const eligible =
    !turn.isFollowUp &&
    !!skillId &&
    underCap &&
    (isThinAnswer(transcript) || mustFollowUp);

  // --- Score AND decide the follow-up in one call. --------------------------
  // This is the one path with a provider call on the critical path, so a
  // failure here — even after its own retries — must not strand the candidate
  // on an error screen. It falls through to the ordinary fast path below
  // instead: rare, and costs at most one skipped follow-up, never a stuck
  // interview.
  if (eligible && skillId) {
    try {
      const ctx = await buildContext(attempt, interview);

      const evaluation = await scoreAndMaybeFollowUp({
        ctx,
        history: toHistory(priorTurns),
        currentSkill: getWorkSkill(skillId),
        currentQuestion: turn.question,
        answerTranscript: transcript,
        skillNumber: skillNumberOf(skillId),
        force: mustFollowUp,
      });

      await writeScoredTurn(turn.id, transcript, languageCode, evaluation);

      // Only dig deeper into a REAL answer. A skip, "I don't know", an evasive
      // reply, or silence-noise that slipped past the earlier checks all score
      // low — and following those up is exactly the behaviour candidates hated.
      // Gate on a scorable answer, EXCEPT when forced to meet the floor (there
      // the model already returns null for a genuine non-answer). Bounded by
      // MAX_FOLLOWUPS_PER_INTERVIEW so the interview can't balloon.
      const followUp = evaluation.nextQuestion?.trim();
      if (
        followUp &&
        (mustFollowUp || evaluation.score >= FOLLOWUP_MIN_SCORE) &&
        followUpsSoFar < MAX_FOLLOWUPS_PER_INTERVIEW
      ) {
        await deliverFollowUp(
          attempt,
          interview,
          turn,
          followUp,
          evaluation.questionTranslation.trim() || null,
        );
        return;
      }

      // Thin answer / non-answer, or no follow-up offered: move on. Scored above.
      await advanceOrFinish(attempt, interview, turn);
      return;
    } catch (error) {
      console.error(
        `[attempt] follow-up decision failed attempt=${attempt.id} turn=${turn.id}, advancing without it: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  // --- Ineligible primary, a follow-up answer, or a failed follow-up decision
  // above: advance fast, score after. --------------------------------------
  const turns = await getTurns(attempt.id);
  const isLast = isLastSkillTurn(turns, turn.turnNumber);

  if (isLast) {
    // Score before the report is written, after any earlier background
    // scoring has landed.
    await scoreTurn({ attempt, interview, turn, transcript, languageCode });
    await settleScoring(attempt.id);
    await finaliseAttempt(attempt.id, interview);
    return;
  }

  await deliverTurn(attempt.id, interview, turn.turnNumber + 1);
}

/**
 * Mark a turn answered without scoring it yet.
 *
 * Scoring is a provider call and the candidate is waiting, so the transcript
 * is written now and the marks land later — see `scheduleScoring`.
 */
async function writeAnsweredTurn(
  turnId: string,
  transcript: string,
  languageCode: string | null,
): Promise<void> {
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
}

/**
 * Score an answer in the background.
 *
 * Never on the candidate's path. `trackScoring` is what lets the final report
 * wait for marks that are still in flight, so a fast finisher does not get a
 * report missing their last answer.
 */
function scheduleScoring(
  attempt: InterviewAttempt,
  interview: Interview,
  turn: InterviewTurn,
  transcript: string,
  languageCode: string | null,
): void {
  if (turn.kind !== "skill" || !turn.skillId) return;

  const scoring = (async () => {
    try {
      await scoreTurn({
        attempt,
        interview,
        turn,
        transcript,
        languageCode,
      });
    } catch (error) {
      console.error(
        `[attempt] scoring failed turn=${turn.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      await db
        .update(interviewTurnsTable)
        .set({
          errorMessage: "This answer could not be scored automatically.",
          updatedAt: new Date(),
        })
        .where(eq(interviewTurnsTable.id, turn.id));
    }
  })();

  trackScoring(attempt.id, scoring);
}

/**
 * End an attempt the candidate walked away from.
 *
 * Without this an abandoned interview sits at "in progress" for ever: the
 * admin list shows a candidate who left twenty minutes ago as still going,
 * and the work they DID do is never scored or reported, because scoring and
 * the summary only run when the last question is answered.
 *
 * It finalises exactly as a completed interview does, so whatever they got
 * through is transcribed, scored and written up — an interview abandoned at
 * question seven is a report on seven questions, not a blank row.
 *
 * Idempotent, and a no-op once an attempt has finished: it is called from a
 * page the candidate may be closing, so it can arrive twice or arrive late.
 */
async function abandonAttemptInner(
  attempt: InterviewAttempt,
  interview: Interview,
): Promise<void> {
  if (attempt.status === "completed" || attempt.status === "failed") return;
  if (attempt.status === "not_started") return;

  /**
   * The interview ended when they stopped, not when we noticed.
   *
   * `updatedAt` is the last sign of life: the page pings every 20 seconds
   * while it is open, so this is within a heartbeat of the moment the tab
   * closed. Read before `settleScoring`, which can take a while and would
   * otherwise drag the timestamp forward.
   */
  const endedAt = attempt.leftAt ?? attempt.updatedAt;

  /**
   * Close it first, then write the report.
   *
   * `finaliseAttempt` scores what is outstanding and asks for a summary, which
   * is several provider calls and can run to half a minute. Leaving the status
   * alone for that long is what kept an abandoned interview showing as "In
   * progress" on the admin list — and kept its duration ticking up, since a
   * running interview is measured against the clock rather than against an end
   * that had not been written yet.
   *
   * Both writes are idempotent, and `finaliseAttempt` sets the same end time
   * again when it lands, so a crash in between still leaves a closed attempt
   * with an honest duration.
   */
  await db
    .update(interviewAttemptsTable)
    .set({ status: "completed", completedAt: endedAt, updatedAt: new Date() })
    .where(eq(interviewAttemptsTable.id, attempt.id));

  // Anything still being scored in the background belongs in the report.
  await settleScoring(attempt.id);
  await finaliseAttempt(attempt.id, interview, endedAt);
}

/**
 * How long an interview can sit untouched before it counts as walked away
 * from.
 *
 * The interview page pings every 20 seconds while it is open, so `updatedAt`
 * moves whether or not the candidate is doing anything. That makes silence
 * unambiguous — it is a closed tab, a dead connection or a flat battery, not
 * someone thinking — and lets this be two minutes rather than the ten it
 * needed when a turn changing was the only sign of life.
 *
 * Still six heartbeats' worth of grace, so a brief network drop or a reload
 * does not end an interview someone is sitting in.
 */
const ABANDONED_AFTER_MS = 2 * 60 * 1000;

/**
 * How long to wait after a browser has told us it is closing.
 *
 * Far shorter than `ABANDONED_AFTER_MS`, because this is not an inference from
 * silence — the tab said so on its way out. The grace is only here to cover a
 * reload, which fires the same event: come back within it and the heartbeat
 * clears `leftAt` and nothing happens.
 */
const LEFT_GRACE_MS = 30 * 1000;

/**
 * Finalise interviews nobody is sitting in any more.
 *
 * The leave button covers the candidate who says they are going. This covers
 * the one who closed the tab, lost their connection, or ran out of battery —
 * no client cooperation, because there is none to be had. Without it those
 * attempts show as "in progress" in the admin list for ever and are never
 * scored, which is what made every abandoned interview look stuck.
 *
 * Called from the admin screens that display attempts, so the list corrects
 * itself when someone looks at it rather than needing a scheduler. Failures
 * are swallowed on purpose: this is a tidy-up, and it must never take down
 * the page that triggered it.
 */
export async function sweepAbandonedAttempts(
  interviewsById: Map<string, Interview>,
  attempts: InterviewAttempt[],
): Promise<void> {
  const now = Date.now();
  const silentCutoff = now - ABANDONED_AFTER_MS;
  const leftCutoff = now - LEFT_GRACE_MS;

  /**
   * Two ways to have gone: said so, or simply stopped.
   *
   * A browser that reported itself closing is taken at its word after a few
   * seconds. Everything else still has to go quiet for the full couple of
   * minutes, because silence alone could be a slow network or a candidate
   * staring at the ceiling.
   */
  const stale = attempts.filter((a) => {
    if (a.status !== "in_progress" && a.status !== "processing") return false;
    if (a.leftAt) return a.leftAt.getTime() < leftCutoff;
    return a.updatedAt.getTime() < silentCutoff;
  });

  for (const attempt of stale) {
    const interview = interviewsById.get(attempt.interviewId);
    if (!interview) continue;
    try {
      await abandonAttempt(attempt, interview);
    } catch (error) {
      console.error(
        `[attempt] sweep could not finalise ${attempt.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Completion                                 */
/* -------------------------------------------------------------------------- */

async function finaliseAttempt(
  attemptId: string,
  interview: Interview,
  /**
   * When the interview actually ended, if that is not now.
   *
   * The sweep finalises abandoned attempts whenever an admin next loads the
   * dashboard, which can be hours after the candidate closed the tab. Stamping
   * `completedAt` with the sweep's clock made the reported duration "how long
   * until somebody looked at the admin page" — one attempt read as 2 hr 12 min
   * for six minutes of interview.
   */
  endedAt?: Date,
): Promise<void> {
  const attempt = await reload(attemptId);
  const turns = await getTurns(attemptId);
  const answered = turns.filter(
    (t) => t.kind === "skill" && t.status === "completed",
  );
  const skillScores = aggregateSkillScores(turns);

  // Overall = the AVERAGE of the skills the candidate actually ANSWERED, on a
  // 0-10 scale (stored ×10 so a decimal survives; the report divides it back).
  // Skipped / unanswered skills are EXCLUDED — not answering one question must
  // never drag the whole score down; the candidate is judged on what they did
  // answer. Deterministic, not the model's number.
  const scored = skillScores.filter((s) => s.score !== null);
  const overallScore =
    scored.length > 0
      ? Math.round(
          (scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length) *
            10,
        )
      : null;

  let summary: string | null = null;
  let strengths: string[] = [];
  let improvements: string[] = [];

  try {
    const report = await generateInterviewSummary({
      ctx: await buildContext(attempt, interview),
      history: toHistory(answered),
      skillScores: skillScores.map((s) => ({
        skillLabel: getWorkSkill(s.skillId).label,
        score: s.score,
      })),
    });
    // Keep only the written summary — the number is the deterministic average
    // above, so the model's overallScore is ignored.
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
      completedAt: endedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attemptId));

  // Post the result to the partner (only for integration candidates, only if a
  // webhook is configured). Best-effort and self-contained — a delivery failure
  // must never undo a finished, saved interview.
  try {
    await deliverResult({
      attempt,
      interview,
      turns,
      skillScores,
      overallScore,
      summary,
      strengths,
      improvements,
    });
  } catch (error) {
    console.error(
      `[attempt] result delivery threw attempt=${attemptId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

/**
 * Re-send a finished attempt's result to the partner webhook, from STORED data.
 *
 * For integration candidates whose result never reached the partner — the
 * webhook URL was added only after they finished, or an earlier delivery
 * failed. Rebuilds the exact payload `finaliseAttempt` sends (no re-scoring, no
 * model calls) and re-runs delivery, which re-stamps `resultDeliveredAt` and
 * re-uploads the report PDF on success.
 */
export async function resendResult(
  attemptId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const attempt = await reload(attemptId);
  if (!attempt.externalStudentId) {
    return {
      ok: false,
      reason: "This candidate did not come through a partner link.",
    };
  }
  if (!env.INTEGRATION_RESULT_WEBHOOK_URL) {
    return { ok: false, reason: "No partner webhook URL is configured." };
  }

  const interview = await db.query.interviewsTable.findFirst({
    where: eq(interviewsTable.id, attempt.interviewId),
  });
  if (!interview) {
    return { ok: false, reason: "That interview could not be found." };
  }

  const turns = await getTurns(attemptId);
  const delivered = await deliverResult({
    attempt,
    interview,
    turns,
    skillScores: aggregateSkillScores(turns),
    overallScore: attempt.overallScore,
    summary: attempt.summary,
    strengths: attempt.strengths ?? [],
    improvements: attempt.improvements ?? [],
  });

  return delivered
    ? { ok: true }
    : {
        ok: false,
        reason: "The partner webhook did not accept the result — see the logs.",
      };
}

/**
 * Re-grade a finished attempt from its STORED transcripts — no re-recording,
 * no STT, no TTS (so it never touches the speech rate limits). Used after a
 * scoring-rubric change to bring old reports in line with the new one.
 *
 * Re-scores every answered skill turn and regenerates the summary + overall
 * score. Skipped / unscored turns keep their null score, and it CANNOT add a
 * follow-up that never happened — it only re-grades what was actually said.
 */
export function rescoreAttempt(attemptId: string): Promise<void> {
  return withUsageScope(attemptId, () => rescoreAttemptInner(attemptId));
}

async function rescoreAttemptInner(attemptId: string): Promise<void> {
  const attempt = await reload(attemptId);
  const interview = await db.query.interviewsTable.findFirst({
    where: eq(interviewsTable.id, attempt.interviewId),
  });
  if (!interview) {
    throw new AttemptError("not_found", "That interview could not be found.");
  }

  const languageCode = attempt.language
    ? resolveInterviewLanguage(attempt.language).code
    : null;
  const turns = await getTurns(attemptId);

  for (const turn of turns) {
    // Only answered, previously-scored skill turns (probes/follow-ups included).
    // Skipped turns keep their null score; empty transcripts are left alone.
    if (turn.kind !== "skill" || turn.status !== "completed") continue;
    if (turn.score === null) continue;
    const transcript = turn.answerTranscript?.trim();
    if (!transcript) continue;

    await scoreTurn({ attempt, interview, turn, transcript, languageCode });
  }

  await finaliseAttempt(attemptId, interview);
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
  /** Total assessable skills (the progress denominator). */
  totalSkills: number;
  /** Which skill (1..totalSkills) the current turn belongs to; 0 on the probe. */
  skillNumber: number;
  needsLanguageChoice: boolean;
  language: string | null;
  isComplete: boolean;
  /**
   * Clip for the question after this one, if it is already prepared, so the
   * browser can fetch it while the candidate is still answering.
   */
  nextQuestionAudioId: string | null;
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
  /**
   * What the browser should play or do next, when there is something.
   *
   * Null for the ordinary case of a fresh question, which the turn itself
   * already describes.
   */
  directive: TurnDirective | null;
  /**
   * Clips for this turn the browser may need without asking: the simpler
   * wording, and the fillers the silence ladder plays. Handed over with the
   * question so a timer never has to wait on a round trip.
   */
  clips: {
    easier: string | null;
    whatHappened: string | null;
    didNotGet: string | null;
    noProblem: string | null;
    closing: string | null;
  };
  /**
   * Which service served each leg (brain, STT, TTS) recently. Development
   * only — always an empty array in production, so it never reaches a real
   * candidate's browser. See `~/server/services/dev-activity`.
   */
  devActivity: ActivityEvent[];
}

/**
 * Attempts whose preparation this process has already picked back up.
 *
 * The poll asks once a second; without this, a stranded clip would start a new
 * voicing run on every one of those.
 */
const reVoicing = new Set<string>();

/**
 * How long a written-but-unvoiced clip may sit before we assume the run that
 * was going to voice it is not coming back.
 *
 * A whole wave is voiced in about a second, so a minute is not impatience — it
 * is long enough that the only rows still waiting are ones whose process died
 * holding them.
 */
const STRANDED_PREPARATION_MS = 60_000;

/**
 * Pick up preparation that was interrupted.
 *
 * Waves run in the background, and a deploy or a crash mid-wave leaves the
 * questions written but silent. Nothing would ever come back for them: the
 * wave that owned them has gone, and the next one is triggered by progress the
 * candidate has already made. The interview survives — delivery falls back to
 * the question's own clip — but quietly loses its simpler wordings and probes
 * for the rest of the session.
 *
 * Gated so the ordinary case costs nothing: preparation is `audio_ready`
 * between waves, which is nearly always, and the query below never runs.
 */
async function reVoiceStrandedClips(attempt: InterviewAttempt): Promise<void> {
  if (attempt.status !== "in_progress" || !attempt.language) return;
  if (attempt.preparationStatus === "audio_ready") return;
  if (reVoicing.has(attempt.id)) return;

  const stranded = await db.query.interviewTurnVariantsTable.findFirst({
    where: and(
      eq(interviewTurnVariantsTable.attemptId, attempt.id),
      eq(interviewTurnVariantsTable.audioStatus, "pending"),
      lt(
        interviewTurnVariantsTable.updatedAt,
        new Date(Date.now() - STRANDED_PREPARATION_MS),
      ),
    ),
    columns: { id: true },
  });
  if (!stranded) return;

  const language = resolveInterviewLanguage(attempt.language);
  reVoicing.add(attempt.id);
  scheduleBackground(`re-voice preparation for ${attempt.id}`, async () => {
    try {
      await withUsageScope(attempt.id, () =>
        voicePendingVariants(attempt.id, language.code),
      );
      await db
        .update(interviewAttemptsTable)
        .set({ preparationStatus: "audio_ready", updatedAt: new Date() })
        .where(eq(interviewAttemptsTable.id, attempt.id));
    } finally {
      // Released whatever happened. A clip that genuinely cannot be voiced is
      // marked `failed` by the voicer and will not be found again; one that
      // failed transiently deserves the next poll's attempt.
      reVoicing.delete(attempt.id);
    }
  });
}

/**
 * Poll target. Also recovers a turn abandoned mid-processing so the UI can
 * offer a retry instead of spinning forever, and picks up preparation whose
 * background run did not survive.
 */
export async function getAttemptStatus(
  attemptId: string,
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

  await reVoiceStrandedClips(attempt);

  const current =
    turns.find((t) => t.turnNumber === attempt.currentQuestionNumber) ?? null;

  /**
   * The clip for the question after this one, when it has already been
   * prepared.
   *
   * Questions are written and voiced an answer ahead, but the browser only
   * learns the clip's address when the turn becomes current — so it starts
   * downloading at the exact moment the candidate is waiting to hear it.
   * Handing the id over early lets the browser fetch it during the answer,
   * and question audio is served from a stable, cacheable URL precisely so
   * that this works.
   */
  const upcoming =
    turns.find((t) => t.turnNumber === attempt.currentQuestionNumber + 1) ??
    null;

  const skillNumber = current?.skillId
    ? skillNumberOf(current.skillId as WorkSkillId)
    : 0;

  /**
   * Only the clips this moment could need.
   *
   * The browser polls every second for the length of the interview, so each
   * lookup here is a query per candidate per second. The ladder's clips are
   * dead weight unless somebody is being listened to, and the closing line is
   * dead weight until the interview is over — so neither is fetched until it
   * is.
   */
  const listening = current?.status === "awaiting_answer";
  const [easier, whatHappened, didNotGet, noProblem, closing] =
    await Promise.all([
      current
        ? variantAudioId(
            attempt.id,
            current.planIndex,
            "easier",
            0,
            current.questionAudioId,
          )
        : null,
      // Seeded by turn so the check-in is not the identical wording at every
      // question, which is what made the old acknowledgement grate.
      listening && current
        ? fillerAudioId(attempt.id, "whatHappened", current.turnNumber)
        : null,
      listening && current
        ? fillerAudioId(attempt.id, "didNotGet", current.turnNumber)
        : null,
      listening && current
        ? fillerAudioId(attempt.id, "noProblem", current.turnNumber)
        : null,
      attempt.status === "completed"
        ? fillerAudioId(attempt.id, "closing", 0)
        : null,
    ]);
  const clips = { easier, whatHappened, didNotGet, noProblem, closing };

  return {
    attemptStatus: attempt.status,
    currentQuestionNumber: attempt.currentQuestionNumber,
    totalSkills: WORK_SKILL_COUNT,
    skillNumber,
    needsLanguageChoice: attempt.needsLanguageChoice,
    language: attempt.language,
    isComplete: attempt.status === "completed",
    nextQuestionAudioId: upcoming?.questionAudioId ?? null,
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
    directive:
      current && current.directiveAction
        ? {
            seq: current.directiveSeq,
            action: current.directiveAction,
            audioId: current.directiveAudioId,
            speechRate: attempt.speechRate,
            resumeRecording: current.directiveAction !== "advance",
          }
        : null,
    clips,
    devActivity: recentActivity(),
  };
}

/**
 * The browser is closing. Note when, so the sweep knows they really went.
 *
 * Deliberately does not finalise anything: this arrives as a beacon during
 * unload, which also fires on a reload and on a restored tab, and ending
 * somebody's interview on that evidence alone would be unrecoverable. The
 * timestamp is a claim; `sweepAbandonedAttempts` decides what it means.
 */
export async function recordLeft(attemptId: string): Promise<void> {
  await db
    .update(interviewAttemptsTable)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(interviewAttemptsTable.id, attemptId),
        inArray(interviewAttemptsTable.status, ["in_progress", "processing"]),
      ),
    );
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

/* -------------------------------------------------------------------------- */
/*                               Usage accounting                             */
/* -------------------------------------------------------------------------- */

/**
 * The public entry points, each wrapped so everything it calls is billed to
 * the right attempt.
 *
 * One scope here covers every provider leg beneath it — STT, TTS and both
 * model paths — without an attempt id in any of their signatures, and without
 * anyone having to remember to pass one when a new leg is added. See
 * `~/server/interview/usage`.
 */

export function startAttempt(
  attemptId: string,
  languageKey: string,
  about: { course: string | null; experience: string | null },
): Promise<void> {
  return withUsageScope(attemptId, () =>
    startAttemptInner(attemptId, languageKey, about),
  );
}

export function regenerateQuestionAudio(
  attempt: InterviewAttempt,
  turnNumber: number,
): Promise<boolean> {
  return withUsageScope(attempt.id, () =>
    regenerateQuestionAudioInner(attempt, turnNumber),
  );
}

export function processTurn(
  attemptId: string,
  turnId: string,
  interview: Interview,
  answer?: AnswerAudio,
): Promise<void> {
  return withUsageScope(attemptId, () =>
    processTurnInner(attemptId, turnId, interview, answer),
  );
}

export function chooseLanguage(
  attempt: InterviewAttempt,
  interview: Interview,
  languageKey: string,
): Promise<void> {
  return withUsageScope(attempt.id, () =>
    chooseLanguageInner(attempt, interview, languageKey),
  );
}

export function abandonAttempt(
  attempt: InterviewAttempt,
  interview: Interview,
): Promise<void> {
  return withUsageScope(attempt.id, () =>
    abandonAttemptInner(attempt, interview),
  );
}
