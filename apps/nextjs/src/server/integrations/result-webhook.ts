import "server-only";

import { eq } from "drizzle-orm";

import { env } from "~/env";
import { getWorkSkill } from "~/config/work-skills";
import type { WorkSkillId } from "~/config/work-skills";
import { db } from "~/server/db";
import { interviewAttemptsTable } from "~/server/db/schema";
import type {
  Interview,
  InterviewAttempt,
  InterviewTurn,
} from "~/server/db/schema";
import type { SkillScore } from "~/lib/scoring";
import {
  presignReportUrl,
  putReportPdf,
} from "~/server/interview/storage";
import { renderAttemptReportPdf } from "./report-pdf";

/**
 * Post a finished student's result to the partner's webhook.
 *
 * Fired once, at the end of `finaliseAttempt`, and only for candidates who
 * carried a partner `externalStudentId` (i.e. came through an integration
 * link). Best-effort: a failure here must never break a finished interview —
 * the result is always saved in our own reports regardless. `resultDeliveredAt`
 * is stamped on success so a later resend can find what did NOT get through.
 */

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 15_000;

export interface ResultPayloadArgs {
  attempt: InterviewAttempt;
  interview: Interview;
  turns: InterviewTurn[];
  skillScores: SkillScore[];
  /** Stored on the ×10 scale (0–100); the payload sends it back as /10. */
  overallScore: number | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
}

/**
 * The result blob — sent to the partner's webhook (push) and also returned by
 * the pull endpoint. Scores are all on a 0–10 scale.
 */
export function buildResultPayload(
  args: ResultPayloadArgs,
): Record<string, unknown> {
  const { attempt, interview, turns, skillScores } = args;

  const intro =
    turns.find((t) => t.kind === "language_probe")?.answerTranscript ?? null;

  const questions = turns
    .filter((t) => t.kind === "skill")
    .map((t) => ({
      turnNumber: t.turnNumber,
      skillId: t.skillId,
      skillLabel: t.skillId
        ? getWorkSkill(t.skillId as WorkSkillId).label
        : null,
      isFollowUp: t.isFollowUp,
      question: t.question,
      questionTranslation: t.questionTranslation,
      answer: t.answerTranscript,
      skipped: t.answerTranscript === null,
      score: t.score,
      evaluation: t.evaluation,
    }));

  return {
    studentId: attempt.externalStudentId,
    attemptId: attempt.id,
    interviewId: interview.id,
    interviewTitle: interview.title,
    candidate: {
      name: attempt.candidateName,
      email: attempt.candidateEmail,
      phone: attempt.candidatePhone,
      course: attempt.candidateCourse,
    },
    language: attempt.language,
    overallScore: args.overallScore === null ? null : args.overallScore / 10,
    skills: skillScores.map((s) => ({
      skillId: s.skillId,
      label: getWorkSkill(s.skillId).label,
      score: s.score,
    })),
    summary: args.summary,
    strengths: args.strengths,
    improvements: args.improvements,
    introduction: intro,
    questions,
    startedAt: attempt.startedAt?.toISOString() ?? null,
    completedAt: attempt.completedAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * @returns true when the partner accepted the result, false otherwise (no
 * webhook configured, not an integration candidate, or every attempt failed).
 * `finaliseAttempt` ignores it; the admin resend uses it to report back.
 */
export async function deliverResult(args: ResultPayloadArgs): Promise<boolean> {
  const url = env.INTEGRATION_RESULT_WEBHOOK_URL;
  if (!url) return false; // No partner webhook configured — nothing to deliver.
  if (!args.attempt.externalStudentId) return false; // Not an integration candidate.

  // Render the report to PDF, store it in R2, and hand the partner a link to
  // it in the payload. Best-effort: if the render or upload fails, the result
  // still goes out with reportUrl null rather than being lost.
  let reportUrl: string | null = null;
  try {
    const pdf = await renderAttemptReportPdf(args.attempt, args.interview);
    const key = `${env.CLOUDFLARE_R2_PREFIX}/reports/${args.attempt.id}.pdf`;
    await putReportPdf(key, pdf);
    reportUrl = await presignReportUrl(key);
  } catch (error) {
    console.error(
      `[integration] report PDF for webhook failed attempt=${args.attempt.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  const body = JSON.stringify({ ...buildResultPayload(args), reportUrl });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.INTEGRATION_RESULT_WEBHOOK_KEY) {
    headers.Authorization = `Bearer ${env.INTEGRATION_RESULT_WEBHOOK_KEY}`;
  }

  for (let attemptNo = 1; attemptNo <= MAX_ATTEMPTS; attemptNo++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) {
        await db
          .update(interviewAttemptsTable)
          .set({ resultDeliveredAt: new Date() })
          .where(eq(interviewAttemptsTable.id, args.attempt.id));
        // Log host + whether the report link made it — NOT the signed URL
        // itself, which is a live 7-day link to a PII report.
        console.log(
          `[integration] result delivered attempt=${args.attempt.id} student=${args.attempt.externalStudentId} -> ${new URL(url).host} (report ${reportUrl ? "included" : "MISSING"})`,
        );
        return true;
      }

      // 4xx (other than 429) is a deterministic rejection — retrying will not
      // help, so stop and leave it undelivered for inspection.
      if (res.status < 500 && res.status !== 429) {
        console.error(
          `[integration] result webhook rejected attempt=${args.attempt.id} status=${res.status}`,
        );
        return false;
      }
      console.warn(
        `[integration] result webhook ${res.status} (try ${attemptNo}/${MAX_ATTEMPTS}) attempt=${args.attempt.id}`,
      );
    } catch (error) {
      console.warn(
        `[integration] result webhook error (try ${attemptNo}/${MAX_ATTEMPTS}) attempt=${args.attempt.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }

    if (attemptNo < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * attemptNo));
    }
  }

  console.error(
    `[integration] result webhook FAILED after ${MAX_ATTEMPTS} tries attempt=${args.attempt.id} (left undelivered)`,
  );
  return false;
}
