import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { env } from "~/env";
import { absoluteUrl } from "~/server/app-url";
import { db } from "~/server/db";
import { interviewAttemptsTable, interviewsTable } from "~/server/db/schema";
import { aggregateSkillScores, getTurns } from "~/server/attempt/service";
import { bearerAuthorised } from "~/server/integrations/auth";
import { buildResultPayload } from "~/server/integrations/result-webhook";
import { renderAttemptReportPdf } from "~/server/integrations/report-pdf";
import { PdfUnavailableError } from "~/server/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Chromium start-up plus a multi-page render, when a PDF is requested. */
export const maxDuration = 60;

/**
 * Pull a finished student's result.
 *
 * PathSaathi has no endpoint to receive a push, but it can make outbound calls
 * — so it fetches the result here by `student_uuid` once the interview is done.
 *   - default: JSON (scores, summary, full Q&A) plus a `reportUrl`.
 *   - `?format=pdf`: the report as a PDF.
 * Returns `{ "status": "pending" }` until the student has a completed attempt,
 * so the caller can poll the same URL.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ studentId: string }> },
): Promise<Response> {
  const apiKey = env.INTEGRATION_API_KEY;
  const interviewToken = env.INTEGRATION_INTERVIEW_TOKEN;
  if (!apiKey || !interviewToken) {
    return NextResponse.json(
      { error: "Student integration is not configured." },
      { status: 503 },
    );
  }
  if (!bearerAuthorised(request, apiKey)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const { studentId } = await ctx.params;

  const interview = await db.query.interviewsTable.findFirst({
    where: eq(interviewsTable.publicToken, interviewToken),
  });
  if (!interview) {
    return NextResponse.json(
      { error: "Integration interview not found." },
      { status: 503 },
    );
  }

  // The student's most recent completed attempt in this interview.
  const attempt = await db.query.interviewAttemptsTable.findFirst({
    where: and(
      eq(interviewAttemptsTable.interviewId, interview.id),
      eq(interviewAttemptsTable.externalStudentId, studentId),
      eq(interviewAttemptsTable.status, "completed"),
    ),
    orderBy: desc(interviewAttemptsTable.completedAt),
  });

  const wantsPdf =
    new URL(request.url).searchParams.get("format") === "pdf";

  if (!attempt) {
    if (wantsPdf) {
      return NextResponse.json(
        { status: "pending", error: "No completed interview yet." },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "pending" });
  }

  if (wantsPdf) {
    try {
      const pdf = await renderAttemptReportPdf(attempt, interview);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="report-${studentId}.pdf"`,
          "Content-Length": String(pdf.byteLength),
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof PdfUnavailableError) {
        return NextResponse.json(
          { error: "PDF export is not available on this server." },
          { status: 501 },
        );
      }
      console.error("[integration] result PDF failed", error);
      return NextResponse.json(
        { error: "The report could not be exported." },
        { status: 500 },
      );
    }
  }

  const turns = await getTurns(attempt.id);
  const payload = buildResultPayload({
    attempt,
    interview,
    turns,
    skillScores: aggregateSkillScores(turns),
    overallScore: attempt.overallScore,
    summary: attempt.summary,
    strengths: attempt.strengths ?? [],
    improvements: attempt.improvements ?? [],
  });
  const reportUrl = await absoluteUrl(
    `/api/integrations/results/${encodeURIComponent(studentId)}?format=pdf`,
  );

  return NextResponse.json({ status: "completed", ...payload, reportUrl });
}
