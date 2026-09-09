import { NextResponse } from "next/server";

import { getAttemptForCandidate } from "~/server/attempt/access";
import { AttemptError, getAttemptStatus } from "~/server/attempt/service";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll target while an answer is being processed. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const { attemptId: raw } = await ctx.params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const found = await getAttemptForCandidate(parsed.data);
  if (!found) {
    return NextResponse.json({ error: "Session expired." }, { status: 401 });
  }

  try {
    const status = await getAttemptStatus(found.attempt.id, found.interview);
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AttemptError) {
      return NextResponse.json(
        { error: error.userMessage },
        { status: error.code === "not_found" ? 404 : 400 },
      );
    }
    console.error("[attempt] status poll failed", error);
    return NextResponse.json(
      { error: "Could not load interview status." },
      { status: 500 },
    );
  }
}
