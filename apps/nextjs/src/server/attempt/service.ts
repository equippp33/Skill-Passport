import "server-only";

import { and, asc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { withUsageScope } from "~/server/interview/usage";
import {
  interviewAttemptsTable,
  interviewAudioTable,
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
import type { TranslatedReport } from "~/server/services/openai";
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
import { adjustScore, aggregateSkillScores } from "~/lib/scoring";
import { ProviderError, toUserMessage } from "~/server/services/errors";
import {
  classifyUtterance,
  evaluateAnswerAndGetNextQuestion,
  generateDoubtResponse,
  generateInterviewSummary,
  translateEvaluations,
  translateReport,
  generateQuestion,
  scoreAndMaybeFollowUp,
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
  previouslyAsked?: string[],
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
    previouslyAsked: previouslyAsked ?? [],
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
  const [introduction, priorAttempts, previouslyAsked] = await Promise.all([
    introductionFor(attempt.id),
    priorAttemptsContext(attempt),
    previouslyAskedQuestions(attempt),
  ]);
  return contextFor(
    attempt,
    interview,
    introduction,
    priorAttempts,
    previouslyAsked,
  );
}

/**
 * Every question this candidate has already been asked at this interview, in
 * English, across all their earlier attempts.
 *
 * Three things are deliberately WIDER than `priorAttemptsContext`:
 *
 *   - every status, not just `completed`. A candidate who abandoned halfway
 *     and came back still heard those questions, and re-asking them is exactly
 *     the complaint;
 *   - every turn, answered or not. A question they sat silent through or
 *     skipped is still one they have had;
 *   - follow-ups included, since those are questions too.
 *
 * Read in English (`questionTranslation`, falling back to the question itself)
 * so a retake in a different language still avoids the same ground — the
 * stored text would otherwise be in a script the comparison could not relate.
 *
 * Best-effort: a failure here means a retake that might repeat itself, which
 * is worth far less than a retake that cannot start at all.
 */
async function previouslyAskedQuestions(
  attempt: InterviewAttempt,
): Promise<string[]> {
  const studentId = attempt.externalStudentId?.trim() || null;
  const email = attempt.candidateEmail?.trim() || null;
  if (!studentId && !email) return [];

  // The same identity a retake is counted by everywhere else.
  const sameCandidate = studentId
    ? eq(interviewAttemptsTable.externalStudentId, studentId)
    : eq(interviewAttemptsTable.candidateEmail, email!);

  try {
    const priors = await db.query.interviewAttemptsTable.findMany({
      columns: { id: true },
      where: and(
        sameCandidate,
        eq(interviewAttemptsTable.interviewId, attempt.interviewId),
        ne(interviewAttemptsTable.id, attempt.id),
      ),
      orderBy: asc(interviewAttemptsTable.createdAt),
    });
    if (priors.length === 0) return [];

    const turns = await db.query.interviewTurnsTable.findMany({
      columns: { question: true, questionTranslation: true },
      where: and(
        inArray(
          interviewTurnsTable.attemptId,
          priors.slice(-MAX_PRIOR_ATTEMPTS).map((p) => p.id),
        ),
        eq(interviewTurnsTable.kind, "skill"),
      ),
      orderBy: asc(interviewTurnsTable.turnNumber),
    });

    const seen = new Set<string>();
    const asked: string[] = [];
    for (const t of turns) {
      const text = (t.questionTranslation?.trim() || t.question || "").trim();
      if (!text) continue;
      const key = normaliseForCompare(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      asked.push(text);
    }
    return asked;
  } catch (error) {
    console.error(
      `[attempt] previously-asked lookup failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return [];
  }
}

/** Lowercase, punctuation-free, single-spaced — for comparing two questions. */
function normaliseForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Are these two questions the same question?
 *
 * Word overlap rather than string equality, because the English a question
 * comes back as is not stable: the fixed pool is stored verbatim for English,
 * Hindi and Marathi, but every other language renders it through the model, so
 * the "same" question returns slightly reworded each time. Comparing exactly
 * would say they differ and let the repeat straight through.
 *
 * 0.6 is well clear of both ends in the eleven-question pool: distinct entries
 * share only stopwords, while a re-rendered one keeps nearly all its content
 * words.
 */
function sameQuestion(a: string, b: string): boolean {
  const left = new Set(normaliseForCompare(a).split(" ").filter(Boolean));
  const right = new Set(normaliseForCompare(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= 0.6;
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
      // Silence on a real question: re-ask it rather than throw a "check your
      // microphone" error at someone who is just thinking or did not catch it.
      // The probe still fails — with no words there is no language to detect.
      // ponytail: no re-ask cap — a permanently silent mic re-asks every 15s;
      // add a counter + move-on-after-N here if that ever bites.
      if (isProbe) {
        await failTurn(
          attemptId,
          turnId,
          "We could not hear an answer in that recording. Please check your microphone and record again.",
        );
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

/**
 * Generate and voice one skill question and insert it, WITHOUT making it the
 * current question. Idempotent: a turn that already exists (because it was
 * prepared ahead of time) is left as it is.
 */
/**
 * Generations currently in flight, keyed by attempt and turn.
 *
 * Questions are prepared an answer ahead, so two callers can want the same
 * turn at once: the look-ahead starts turn N+2, and a candidate who answers
 * quickly has `deliverTurn` reach for N+2 before that finishes. Without
 * this both would call OpenAI and Sarvam, and one insert would then be
 * dropped by `onConflictDoNothing` — after its clip had been generated,
 * paid for and stored with nothing left pointing at it.
 *
 * Sharing the promise makes the second caller wait for the first instead.
 * In-process only, which covers the case that actually happens; the
 * conflict clause below remains the backstop across instances.
 */
const questionsInFlight = new Map<string, Promise<void>>();

function buildAndInsertQuestion(
  attemptId: string,
  interview: Interview,
  turnNumber: number,
): Promise<void> {
  const key = `${attemptId}:${turnNumber}`;
  const existing = questionsInFlight.get(key);
  if (existing) return existing;

  const work = generateAndInsertQuestion(
    attemptId,
    interview,
    turnNumber,
  ).finally(() => questionsInFlight.delete(key));

  questionsInFlight.set(key, work);
  return work;
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
  // Drop the ones this candidate has already had. The opener is the first
  // thing they hear, so repeating it makes a retake feel identical before a
  // single generated question has been reached — and unlike the AI questions,
  // nothing here was stopping it: the pick was a bare random index.
  const asked = ctx.previouslyAsked ?? [];
  const unused = WORK_READINESS_QUESTIONS.filter(
    (candidate) => !asked.some((prior) => sameQuestion(prior, candidate.en)),
  );
  // Eleven questions against a retake limit of three, so this should never
  // empty. If it somehow does, repeating one beats failing to ask anything.
  const pool = unused.length > 0 ? unused : WORK_READINESS_QUESTIONS;
  const q = pool[Math.floor(Math.random() * pool.length)]!;
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
 * Prepare the NEXT question in the background, so it is ready the instant the
 * candidate finishes the one in front of them.
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
  /**
   * Whether to wait for the look-ahead before returning.
   *
   * True from the background pipeline, where waiting keeps the work inside
   * the `after()` window that is keeping the process alive. False from a
   * request the candidate is sitting in front of — they need THIS question,
   * not the one after it, and making them wait on a second OpenAI and TTS
   * round trip is the opposite of what preparing ahead is for.
   */
  awaitPrefetch = true,
): Promise<void> {
  const turns = await getTurns(attemptId);
  if (!turns.some((t) => t.turnNumber === turnNumber)) {
    if (!nextPrimarySkill(turns)) return;
    await buildAndInsertQuestion(attemptId, interview, turnNumber);
  }

  await db
    .update(interviewAttemptsTable)
    .set({
      status: "in_progress",
      currentQuestionNumber: turnNumber,
      updatedAt: new Date(),
    })
    .where(eq(interviewAttemptsTable.id, attemptId));

  const lookAhead = prefetchNextQuestion(attemptId, interview, turnNumber);
  if (awaitPrefetch) await lookAhead;
}

/**
 * Insert a follow-up the model just produced from the answer, voice it, make
 * it current, and start preparing the primary after it.
 *
 * A follow-up keeps the current turn's skill and never spawns another — so the
 * question after it is a plain primary, safe to prepare ahead.
 */
async function deliverFollowUp(
  attempt: InterviewAttempt,
  interview: Interview,
  currentTurn: InterviewTurn,
  followUpQuestion: string,
  followUpTranslation: string | null,
): Promise<void> {
  const nextTurnNumber = currentTurn.turnNumber + 1;
  const language = resolveInterviewLanguage(attempt.language!);
  const questionAudioId = await synthesiseQuestionAudio(
    attempt.id,
    followUpQuestion,
    language.code,
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
    if (prepared.questionAudioId)
      await discardAudioClip(prepared.questionAudioId);
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
  /**
   * A context built by the caller.
   *
   * Identical for every turn of one attempt, and building it costs three
   * queries — one of which walks this candidate's earlier attempts. A
   * re-score does eleven turns, so building it per turn meant thirty-three
   * queries to produce eleven copies of the same object.
   */
  ctx?: InterviewContext;
}): Promise<void> {
  const { attempt, interview, turn, transcript, languageCode } = args;
  const ctx = args.ctx ?? (await buildContext(attempt, interview));

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
  },
): Promise<void> {
  await db
    .update(interviewTurnsTable)
    .set({
      answerTranscript: transcript,
      detectedLanguageCode: languageCode,
      score: adjustScore(evaluation.score),
      evaluation: evaluation.evaluation,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
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
  const { attempt, interview, turn, transcript, languageCode } = args;

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

  await db
    .update(interviewTurnsTable)
    .set({
      answerTranscript: transcript,
      detectedLanguageCode: languageCode,
      status: "completed",
      errorMessage: null,
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(interviewTurnsTable.id, turn.id));

  await deliverTurn(attempt.id, interview, turn.turnNumber + 1);

  // The candidate has already moved on, so a scoring failure must not fail the
  // turn — an unscored answer is shown as such in the report and no more.
  const scoring = scoreTurn({
    attempt,
    interview,
    turn,
    transcript,
    languageCode,
  }).catch(async (error) => {
    console.error(
      `[attempt] background scoring failed attempt=${attempt.id} turn=${turn.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    await db
      .update(interviewTurnsTable)
      .set({
        errorMessage: "This answer could not be scored automatically.",
        updatedAt: new Date(),
      })
      .where(eq(interviewTurnsTable.id, turn.id))
      .catch(() => undefined);
  });

  trackScoring(attempt.id, scoring);
  await scoring;
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

  /**
   * The same report in the candidate's own language.
   *
   * English stays canonical — reviewers read it, the partner API has always
   * returned it, and the scoring prompts are tuned to produce it. This is a
   * translation of that, so the two can never say different things.
   *
   * Best-effort and deliberately last: it runs after the English report is in
   * hand, and every failure path leaves `translated` null rather than throwing.
   * A candidate must never lose their report because a translation call timed
   * out. Skipped entirely for an English interview, where there is nothing to
   * translate.
   */
  let translated: TranslatedReport | null = null;
  const reportLanguage =
    attempt.language && attempt.language !== "english"
      ? attempt.language
      : null;

  if (reportLanguage && summary) {
    try {
      translated = await translateReport({
        languageName: resolveInterviewLanguage(reportLanguage).promptName,
        summary,
        strengths,
        improvements,
      });
    } catch (error) {
      console.error(
        `[attempt] report translation failed attempt=${attemptId}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  // The per-question feedback, in the candidate's language too. Runs after
  // the report translation rather than beside it so a failure in either leaves
  // the other intact, and so the two share the provider rather than racing for
  // it. Entirely best-effort: a completed interview must never fail to
  // complete because a translation did not come back.
  if (reportLanguage) await translateTurnEvaluations(attemptId, reportLanguage);

  await db
    .update(interviewAttemptsTable)
    .set({
      status: "completed",
      overallScore,
      summary,
      strengths,
      improvements,
      summaryTranslated: translated?.summary ?? null,
      strengthsTranslated: translated?.strengths ?? null,
      improvementsTranslated: translated?.improvements ?? null,
      // Only set when there IS a translation, so this doubles as the flag for
      // "a translated report exists" rather than "the interview had a language".
      reportLanguage: translated ? reportLanguage : null,
      completedAt: new Date(),
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
/** How many answers to re-score at once. See `rescoreAttemptInner`. */
const RESCORE_CONCURRENCY = 4;

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

  // Only answered, previously-scored skill turns (probes/follow-ups included).
  // Skipped turns keep their null score; empty transcripts are left alone.
  const eligible = turns.flatMap((turn) => {
    if (turn.kind !== "skill" || turn.status !== "completed") return [];
    if (turn.score === null) return [];
    const transcript = turn.answerTranscript?.trim();
    return transcript ? [{ turn, transcript }] : [];
  });

  // Built once for the whole attempt rather than once per turn.
  const ctx = await buildContext(attempt, interview);

  /**
   * Scored in parallel, a few at a time.
   *
   * Re-scoring one turn reads only the QUESTIONS AND ANSWERS of the turns
   * before it — never their scores — and none of those change here, so the
   * turns do not depend on each other and the sequential loop this replaces
   * was pure waiting. Eleven answers at ten to forty seconds each is three
   * minutes of an admin watching a spinner for work that has no order to it.
   *
   * Batched rather than all at once: a dozen simultaneous analysis calls is
   * how one button press trips a rate limit and opens the circuit breaker for
   * everybody mid-interview.
   */
  const failures: unknown[] = [];
  for (let i = 0; i < eligible.length; i += RESCORE_CONCURRENCY) {
    const settled = await Promise.allSettled(
      eligible
        .slice(i, i + RESCORE_CONCURRENCY)
        .map(({ turn, transcript }) =>
          scoreTurn({ attempt, interview, turn, transcript, languageCode, ctx }),
        ),
    );
    for (const r of settled) if (r.status === "rejected") failures.push(r.reason);
  }
  // Surfaced only after every turn has had its go, so one bad answer does not
  // cost the rest their re-score.
  if (failures.length > 0) throw failures[0];

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
}

/**
 * Poll target. Also recovers a turn abandoned mid-processing so the UI can
 * offer a retry instead of spinning forever.
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

/**
 * Translate every scored turn's evaluation into the interview language.
 *
 * Reads the turns back rather than taking them as an argument because the
 * caller has already written its scores by this point, and re-reading is the
 * only way to be sure the text being translated is the text that was stored.
 *
 * Writes each translation against its own turn id, so the positional pairing
 * from the model is resolved here, once, next to the data — rather than being
 * carried any further.
 */
async function translateTurnEvaluations(
  attemptId: string,
  languageKey: string,
): Promise<void> {
  try {
    const turns = await db.query.interviewTurnsTable.findMany({
      columns: { id: true, evaluation: true },
      where: and(
        eq(interviewTurnsTable.attemptId, attemptId),
        eq(interviewTurnsTable.status, "completed"),
      ),
      orderBy: asc(interviewTurnsTable.turnNumber),
    });

    const scored = turns.filter(
      (t): t is typeof t & { evaluation: string } =>
        typeof t.evaluation === "string" && t.evaluation.trim().length > 0,
    );
    if (scored.length === 0) return;

    const translations = await translateEvaluations({
      languageName: resolveInterviewLanguage(languageKey).promptName,
      evaluations: scored.map((t) => t.evaluation.trim()),
    });
    // Empty means the count came back wrong and was rejected upstream.
    if (translations.length !== scored.length) return;

    await Promise.all(
      scored.map((turn, i) =>
        db
          .update(interviewTurnsTable)
          .set({ evaluationTranslated: translations[i] ?? null })
          .where(eq(interviewTurnsTable.id, turn.id)),
      ),
    );
  } catch (error) {
    console.error(
      `[attempt] evaluation translation failed attempt=${attemptId}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}
