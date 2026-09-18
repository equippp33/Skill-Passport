import "server-only";

import { after } from "next/server";

import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  interviewAttemptsTable,
  interviewsTable,
  interviewAudioTable,
  interviewTurnVariantsTable,
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
  openerFor,
  PROBE_SPOKEN_LANGUAGE_CODE,
  WRONG_LANGUAGE_NOTICE,
} from "~/config/greeting";
import {
  LANGUAGE_PROBE_TURN,
  WORK_SKILLS,
  WORK_SKILL_COUNT,
  WORK_SKILL_IDS,
  getWorkSkill,
} from "~/config/work-skills";
import type { WorkSkill, WorkSkillId } from "~/config/work-skills";
import { isRepeatRequest, phraseIntent } from "~/config/repeat-requests";
import { FILLERS } from "~/config/fillers";
import type { FillerKind } from "~/config/fillers";
import { aggregateSkillScores } from "~/lib/scoring";
import { ProviderError, toUserMessage } from "~/server/services/errors";
import {
  evaluateAnswerAndGetNextQuestion,
  generateInterviewSummary,
  prepareQuestions,
  generateQuestion,
  translateQuestion,
} from "~/server/services/openai";
import type {
  InterviewContext,
  PreparedQuestion,
  PriorTurn,
} from "~/server/services/openai";
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
    candidateName: firstNameOf(attempt.candidateName),
    candidateIntroduction: introduction ?? null,
  };
}

/**
 * What to actually call someone, from the full name they typed in.
 *
 * The first word, because "Priya Sharma, tell me about a time..." is a summons
 * and not a conversation. Capped and stripped of punctuation: this is free
 * text a candidate typed, it is about to be spoken aloud by TTS, and a name
 * that is forty characters of symbols is not a name.
 */
function firstNameOf(fullName: string): string | null {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  const cleaned = first.replace(/[^\p{L}\p{M}'-]/gu, "").slice(0, 32);
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * The two intake answers as one paragraph, for the prompt and the report.
 *
 * Labelled rather than concatenated: "B.Com final year" and "weekends at my
 * uncle's shop" mean very different things to a question writer, and running
 * them together loses which is which.
 */
function composeBackground(about: {
  course: string | null;
  experience: string | null;
}): string {
  const parts: string[] = [];
  const course = about.course?.trim();
  const experience = about.experience?.trim();
  if (course) parts.push(`Studying: ${course}`);
  if (experience) parts.push(`Work experience: ${experience}`);
  return parts.join("\n");
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
 * Begin an attempt by creating the language probe.
 *
 * Idempotent: a refresh or double click returns the existing state rather than
 * creating a second turn. No OpenAI call happens here — the probe is fixed
 * text, because we do not yet know what language to generate in.
 */
async function startAttemptInner(
  attemptId: string,
  /**
   * The language the candidate picked before starting.
   *
   * Chosen up front now rather than inferred from the first answer, so the
   * opener is already spoken in it — greeting someone in English and
   * switching afterwards undoes the choice they just made. Detection still
   * runs on every answer, but only to notice a candidate drifting to another
   * language, never to override this.
   */
  languageKey: string,
  /** What the candidate typed about themselves on the same screen. */
  about: { course: string | null; experience: string | null },
): Promise<void> {
  const language = resolveInterviewLanguage(languageKey);
  const attempt = await reload(attemptId);
  const existing = await getTurns(attemptId);
  if (attempt.status !== "not_started" || existing.length > 0) return;

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

  // Another request won the race; it created the probe.
  if (!claimed) return;

  const opener = openerFor(language.key, firstNameOf(attempt.candidateName));

  await db.insert(interviewTurnsTable).values({
    attemptId,
    turnNumber: LANGUAGE_PROBE_TURN,
    kind: "language_probe",
    skillId: null,
    question: opener,
    status: "awaiting_answer",
  });

  await tryAttachQuestionAudio(
    attemptId,
    LANGUAGE_PROBE_TURN,
    opener,
    language.code,
  );

  /**
   * The rest of the interview is written while the candidate listens to the
   * opener.
   *
   * Not awaited: the opener is fixed text that was already voiced above, so
   * there is nothing to wait for. By the time they have answered it — thirty
   * seconds at the very least — the warm-ups and the first band of skills are
   * written and voiced, and from then on every question is already waiting.
   */
  scheduleBackground(`prepare wave 0 for ${attemptId}`, async () => {
    const interview = await db.query.interviewsTable.findFirst({
      where: eq(interviewsTable.id, attempt.interviewId),
    });
    if (!interview) return;
    await withUsageScope(attemptId, () => prepareWave(attemptId, interview, 0));
  });
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

async function regenerateQuestionAudioInner(
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
 * The pieces are transcribed IN PARALLEL, not one after another — a long
 * answer is cut into ~25-second segments, and transcribing them serially made
 * the wait scale with how long the candidate spoke (five segments meant five
 * Sarvam calls back to back). Firing them together turns that into roughly the
 * time of a single segment. Order still matters for the final transcript, so
 * the results are stitched back together in segment order regardless of which
 * finished first.
 *
 * The language reported is the one from the longest-transcribing segment —
 * the opening few words of a reply are the least reliable place to judge
 * from, and a candidate who switches language mid-answer should be read as
 * whatever they mostly spoke.
 */
/**
 * Longest transcribed slice wins the language vote, and a short slice in a
 * DIFFERENT language than that winner is dropped.
 *
 * Sarvam, told to detect ("unknown"), free-guesses a language per segment and
 * on a silent tail hallucinates a stray phrase in a random script — the
 * "આપણે હા ચાલો" / "achcha achcha" garbage that used to get appended to
 * answers. A real answer slice is substantial; a hallucination is short and
 * off-language. So detection still runs every turn (switching works), but the
 * junk slice is discarded and cannot corrupt the transcript or flip the
 * detected language.
 */
const HALLUCINATION_MAX_CHARS = 40;

async function transcribeSegments(answer: AnswerAudio): Promise<{
  transcript: string;
  languageCode: string | null;
  languageProbability: number | null;
}> {
  const settled = await Promise.all(
    answer.segments.map(async (segment) => {
      try {
        const result = await transcribeAudio({
          audio: segment,
          mimeType: answer.mimeType,
          languageCode: "unknown",
        });
        return {
          ok: true as const,
          text: result.transcript?.trim() ?? "",
          code: result.languageCode,
          probability: result.languageProbability,
        };
      } catch (error) {
        // One bad slice must not lose the whole answer — a rollover can leave
        // a final fragment of a fraction of a second, which is exactly the
        // sort of thing a transcriber rejects.
        console.error(
          `[attempt] segment transcription failed: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        return { ok: false as const };
      }
    }),
  );

  // First pass: the longest slice decides the answer's language. It is the
  // most real thing here — a hallucination on silence is always short.
  let best: { code: string | null; probability: number | null; len: number } = {
    code: null,
    probability: null,
    len: -1,
  };
  let failures = 0;
  for (const result of settled) {
    if (!result.ok) {
      failures += 1;
      continue;
    }
    if (result.text.length > best.len) {
      best = {
        code: result.code,
        probability: result.probability,
        len: result.text.length,
      };
    }
  }

  // Second pass, in segment order so the transcript reads the way it was
  // spoken. Drop a short slice whose language differs from the winner — that
  // is a silence hallucination, not part of the answer.
  const parts: string[] = [];
  for (const result of settled) {
    if (!result.ok || !result.text) continue;
    const offDominant =
      best.code !== null && result.code !== null && result.code !== best.code;
    if (offDominant && result.text.length < HALLUCINATION_MAX_CHARS) continue;
    parts.push(result.text);
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

async function processTurnInner(
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

    // Diagnostic: what Sarvam actually heard, and whether we read it as a
    // "repeat the question" request. A repeat spoken in English during a
    // non-English interview can be mis-transcribed into the session script and
    // slip past isRepeatRequest — this line is how we confirm that.
    console.log(
      `[attempt] heard turn=${turn.turnNumber} lang=${languageCode} repeat=${isRepeatRequest(
        transcript,
      )} transcript=${JSON.stringify(transcript.slice(0, 160))}`,
    );

    const isProbe = turn.kind === "language_probe";

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
    // interviewer instead of scoring it as the answer. The probe is never
    // classified: its only job is to capture a language sample.
    const detected = languageFromCode(languageCode);
    const confident =
      (languageProbability ?? 0) >= LANGUAGE_CONFIDENCE_THRESHOLD;

    /**
     * Is this a request rather than an answer?
     *
     * A phrase list, and no model call. This runs on every answer, so asking
     * a model would tax every turn to catch a rare one — and an interview
     * that has to wait for a provider before it can repeat itself does not
     * feel responsive, which is the whole point of the exercise.
     *
     * The question text NEVER changes here. Whichever branch runs, the words
     * on screen stay as they were until the candidate actually answers them;
     * only what the interviewer says out loud differs.
     */
    const intent = phraseIntent(transcript);
    if (intent) {
      switch (intent) {
        case "slower": {
          // Recorded on the attempt rather than the turn: "slowly" is a
          // standing request, not a comment on this one question.
          await db
            .update(interviewAttemptsTable)
            .set({ speechRate: SLOWER_SPEECH_RATE, updatedAt: new Date() })
            .where(eq(interviewAttemptsTable.id, attemptId));
          await issueDirective(turnId, "replay", turn.questionAudioId);
          break;
        }
        case "not_understood": {
          // The prepared simpler wording, falling back to the question itself
          // when this turn has none — the opener, or a wave that failed.
          const easier = await variantAudioId(
            attemptId,
            turn.planIndex,
            "easier",
            0,
            turn.questionAudioId,
          );
          await issueDirective(turnId, "play_easier", easier);
          break;
        }
        case "repeat":
        default: {
          await issueDirective(turnId, "replay", turn.questionAudioId);
          break;
        }
      }
      return;
    }

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

    // --- 2. The language is the candidate's choice, and only theirs --------
    //
    // Detection used to switch the interview whenever it heard something
    // different and was confident about it. That was wrong twice over: a
    // short, quiet or noisy answer is misdetected often enough that
    // interviews flipped language on their own, mid-way, without anyone
    // asking — and even a correct detection is not a request. Someone
    // answering one question in English inside a Hindi interview has not
    // asked for the rest of it in English.
    //
    // So the language now changes in exactly one place: the picker in the
    // header, when the candidate reaches for it. Detection still runs and is
    // still stored per turn — the report shows which languages were actually
    // spoken, and `wrongLanguageNotice` uses it to ask them, kindly, to stay
    // in the one they chose — but it no longer decides anything.
    const activeLanguage = attempt.language as InterviewLanguageKey | null;
    if (!activeLanguage) {
      await failTurn(
        attemptId,
        turnId,
        "We could not determine your language. Please choose one and try again.",
      );
      return;
    }

    await handleAnsweredTurn({
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

  // The candidate chose their language before the interview started, so the
  // probe no longer decides it — their choice stands even if they answered
  // this one in something else. `generateAndInsertQuestion` notices that
  // mismatch separately and has the interviewer mention it, kindly.
  //
  // The detection branches below remain for an attempt with no language at
  // all: one started before the chooser existed, or any future path that
  // skips it. Falling back to detection is better than stalling.
  if (!attempt.language) {
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
  }

  await deliverTurn(attempt.id, interview, LANGUAGE_PROBE_TURN + 1);
}

/** Candidate picked a language after detection failed. */
async function chooseLanguageInner(
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

  // Before anything else, and regardless of what the candidate is looking
  // at: questions are prepared ahead, so a switch has to reach past the one
  // on screen. Anything already written for a later turn is in the language
  // they just rejected.
  //
  // These used to be DELETED and written again from scratch. They are
  // translated in place instead: the question a candidate gets should not
  // depend on which language they happened to pick, and regenerating meant a
  // switch quietly changed the interview as well as its language. It is also
  // cheaper — a translation is shorter than an authored question — and it
  // keeps whatever the look-ahead had already paid for.
  //
  // This sits above the guards further down deliberately: switching while
  // the current answer is still processing is exactly when someone realises
  // the language is wrong, and skipping it there left the next question in
  // the old language.
  await translatePreparedQuestions(
    attempt.id,
    attempt.currentQuestionNumber,
    language,
  );

  const turns = await getTurns(attempt.id);
  const next = LANGUAGE_PROBE_TURN + 1;

  // Nothing asked yet: the first real question is simply written in the
  // language that was just chosen.
  if (!turns.some((t) => t.turnNumber === next)) {
    await deliverTurn(attempt.id, interview, next);
    return;
  }

  // Mid-interview switch. Re-ask what is on screen right now in the new
  // language rather than waiting for the next question — a candidate who
  // says they cannot follow the language is telling us about the question
  // in front of them, and leaving it there makes them answer it anyway.
  const current = turns.find(
    (t) => t.turnNumber === attempt.currentQuestionNumber,
  );
  // Only the question actually on screen can be rewritten in place; one
  // being processed or already answered is left alone. The discard above
  // has already dealt with everything after it either way.
  if (!current || current.status !== "awaiting_answer") return;
  if (current.kind === "language_probe") return;

  await reaskInLanguage(attempt.id, current, language);
}

/**
 * Rewrite every question prepared ahead into the newly chosen language.
 *
 * Only unanswered turns past the current one: an answered turn is part of the
 * record and must keep the wording the candidate actually heard, and the
 * current one is handled by `reaskInLanguage` so the candidate is not left
 * staring at a question that changes under them.
 *
 * Sequential rather than parallel. There is normally exactly one prepared
 * question, so concurrency buys nothing, and a language switch is already a
 * moment where the candidate is waiting — two provider calls racing would
 * only make a failure harder to reason about.
 *
 * Best-effort per turn: a translation that fails leaves that question in the
 * old language, which is worse than switching but far better than deleting a
 * question and leaving a hole in the interview.
 */
async function translatePreparedQuestions(
  attemptId: string,
  currentTurnNumber: number,
  language: ReturnType<typeof resolveInterviewLanguage>,
): Promise<void> {
  const prepared = await db.query.interviewTurnsTable.findMany({
    where: and(
      eq(interviewTurnsTable.attemptId, attemptId),
      gt(interviewTurnsTable.turnNumber, currentTurnNumber),
      isNull(interviewTurnsTable.answerTranscript),
    ),
    orderBy: asc(interviewTurnsTable.turnNumber),
  });
  if (prepared.length === 0) return;

  for (const turn of prepared) {
    // The clip it points at is about to be replaced, so take the old one out
    // of storage rather than leaving it billed and unreferenced.
    const previousAudioId = turn.questionAudioId;
    await reaskInLanguage(attemptId, turn, language);
    if (previousAudioId) await discardAudioClip(previousAudioId);
  }
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
        text,
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
      await storeFillers(attemptId, language.key);

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

/** 1-based position of a skill in the fixed framework order. */
function skillNumberOf(skillId: WorkSkillId): number {
  return WORK_SKILL_IDS.indexOf(skillId) + 1;
}

/**
 * The kind reminder, when the candidate answered in a language they did not
 * choose — or null, which is the normal case.
 *
 * Only fires on the MOST RECENT answer, and only when Sarvam is sure enough
 * to be worth acting on: a candidate who borrows an English word mid-sentence
 * has not switched language, and telling them they have would be both wrong
 * and discouraging. Saying it once per drift is the point; saying it every
 * turn would nag.
 */
function wrongLanguageNotice(
  attempt: InterviewAttempt,
  priorTurns: InterviewTurn[],
): string | null {
  if (!attempt.language) return null;

  const answered = priorTurns.filter((t) => t.answerTranscript);
  const last = answered[answered.length - 1];
  if (!last?.detectedLanguageCode) return null;

  const spoken = languageFromCode(last.detectedLanguageCode);
  if (!spoken || spoken === attempt.language) return null;

  // Already said it for the previous answer — do not repeat it every turn
  // while the candidate is mid-sentence in their own language.
  const before = answered[answered.length - 2];
  if (before?.detectedLanguageCode) {
    const earlier = languageFromCode(before.detectedLanguageCode);
    if (earlier && earlier !== attempt.language) return null;
  }

  return WRONG_LANGUAGE_NOTICE[attempt.language as InterviewLanguageKey];
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

  const ctx = contextFor(attempt, interview, await introductionFor(attemptId));
  const generated = await generateQuestion({
    ctx,
    skill,
    turnNumber: skillNumberOf(skill.id),
    history: toHistory(priorTurns),
  });

  /**
   * Said before the question when the last answer was in another language.
   *
   * Spoken only — it is prepended to the text sent to TTS, never to the
   * question that is stored, shown on screen or put in the report, because
   * it is an aside to this candidate at this moment and not part of the
   * question itself.
   */
  const spokenPrefix = wrongLanguageNotice(attempt, priorTurns);

  // Voiced before the turn is written, so it is never current without audio.
  const questionAudioId = await synthesiseQuestionAudio(
    attemptId,
    spokenPrefix ? `${spokenPrefix} ${generated.question}` : generated.question,
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
 * The question is normally already sitting there, written and voiced by a
 * wave. Generating one here is the emergency path — a wave that failed, or an
 * interview that got ahead of its plan — and it is synchronous because the
 * candidate is looking at the screen: one slow question beats a dead
 * interview.
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
  if (nextWave > 0) {
    scheduleBackground(`prepare wave ${nextWave} for ${attemptId}`, () =>
      withUsageScope(attemptId, () =>
        prepareWave(attemptId, interview, nextWave),
      ),
    );
  }

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
  const ctx = contextFor(attempt, interview, await introductionFor(attempt.id));

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
      score: evaluation.score,
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
  const language = attempt.language as InterviewLanguageKey | null;
  const words = transcript.trim().split(/\s+/).filter(Boolean);

  /**
   * Did they actually say something, or just make a noise at us?
   *
   * Two words or twenty-five characters, whichever they cross first. Counting
   * words alone under-reads scripts that write a whole clause without spaces;
   * counting characters alone over-reads a short but complete English answer.
   */
  const isThinAnswer = words.length <= 2 || transcript.trim().length < 25;

  /**
   * "Would you like to add anything?" — once, and only for a thin answer.
   *
   * The distinction this draws is between a candidate who has finished and
   * one who has not started. Asking twice would be nagging, so the timestamp
   * is the guard; asking a candidate who gave a real answer would be rude, so
   * the length is.
   */
  if (isThinAnswer && !turn.addMorePromptedAt && language) {
    const audioId = await fillerAudioId(
      attempt.id,
      "addMore",
      turn.turnNumber + turn.directiveSeq,
    );
    if (audioId) {
      await db
        .update(interviewTurnsTable)
        .set({ addMorePromptedAt: new Date(), updatedAt: new Date() })
        .where(eq(interviewTurnsTable.id, turn.id));
      await issueDirective(turn.id, "play_filler", audioId);
      // Scored in the background all the same: if they say nothing more, what
      // they already said is the answer and it should not go unmarked.
      scheduleScoring(attempt, interview, turn, transcript, languageCode);
      return;
    }
  }

  /**
   * A prepared follow-up, when the answer was substantial enough to dig into.
   *
   * Gated on length rather than on the model's judgment, which is what used to
   * decide this. A probe written before the answer existed cannot refer to
   * what they said, so asking one after a one-line answer produces "can you
   * give an example?" when the honest answer is that there was nothing there
   * to expand. Fifteen words is the line between an answer with something in
   * it and an answer that merely exists.
   */
  const SUBSTANTIAL_ANSWER_WORDS = 15;
  const canProbe =
    !turn.isFollowUp &&
    !!skillId &&
    !!language &&
    interview.followUpSkills.includes(skillId) &&
    turn.followUpsAsked < MAX_FOLLOW_UPS &&
    words.length >= SUBSTANTIAL_ANSWER_WORDS;

  if (canProbe) {
    const probeAudio = await variantAudioId(
      attempt.id,
      turn.planIndex,
      "probe",
      turn.followUpsAsked,
      null,
    );
    if (probeAudio) {
      await db
        .update(interviewTurnsTable)
        .set({
          followUpsAsked: sql`${interviewTurnsTable.followUpsAsked} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(interviewTurnsTable.id, turn.id));
      await issueDirective(turn.id, "play_probe", probeAudio);
      scheduleScoring(attempt, interview, turn, transcript, languageCode);
      return;
    }
  }

  // --- Nothing more to ask of this turn: acknowledge, score, move on. -------
  await writeAnsweredTurn(turn.id, transcript, languageCode);
  scheduleScoring(attempt, interview, turn, transcript, languageCode);

  const turns = await getTurns(attempt.id);
  if (!nextPrimarySkill(turns)) {
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

  // Anything still being scored in the background belongs in the report.
  await settleScoring(attempt.id);
  await finaliseAttempt(attempt.id, interview);
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
  const cutoff = Date.now() - ABANDONED_AFTER_MS;
  const stale = attempts.filter(
    (a) =>
      (a.status === "in_progress" || a.status === "processing") &&
      a.updatedAt.getTime() < cutoff,
  );

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
    takeYourTime: string | null;
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
  const [easier, takeYourTime, noProblem, closing] = await Promise.all([
    current
      ? variantAudioId(
          attempt.id,
          current.planIndex,
          "easier",
          0,
          current.questionAudioId,
        )
      : null,
    // Seeded by turn so the reassurance is not the identical syllable at every
    // question, which is what made the old acknowledgement grate.
    listening && current
      ? fillerAudioId(attempt.id, "takeYourTime", current.turnNumber)
      : null,
    listening && current
      ? fillerAudioId(attempt.id, "noProblem", current.turnNumber)
      : null,
    attempt.status === "completed"
      ? fillerAudioId(attempt.id, "closing", 0)
      : null,
  ]);
  const clips = { easier, takeYourTime, noProblem, closing };

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
