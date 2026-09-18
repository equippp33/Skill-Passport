import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { interviewAttemptsTable } from "~/server/db/schema";
import { getAttemptForCandidate } from "~/server/attempt/access";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "I am still here."
 *
 * Sent every few seconds while the interview screen is open, and its only
 * effect is to move `updatedAt` forward.
 *
 * This is what lets an abandoned interview be spotted quickly. Without it the
 * only sign of life is a turn changing, and a candidate can legitimately sit
 * on one question for minutes — so an attempt had to be silent for ten
 * minutes before it could safely be called abandoned, and a closed tab showed
 * as "in progress" for that whole time. A page that pings while it is open
 * means silence is unambiguous: a couple of minutes of it and nobody is
 * there.
 *
 * Nothing is read back, so the body is empty and the response is tiny.
 */
export async function POST(
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

  // Only while it is running: a finished attempt must not be dragged back to
  // looking live by a tab left open on the results page.
  if (
    found.attempt.status === "in_progress" ||
    found.attempt.status === "processing"
  ) {
    await db
      .update(interviewAttemptsTable)
      // `leftAt` is cleared here, and this is the only place it is cleared.
      // The unload beacon fires on a reload as well as on a real close, so a
      // tab that comes back must be able to take it back — otherwise
      // refreshing the page would end the interview.
      .set({ updatedAt: new Date(), leftAt: null })
      .where(eq(interviewAttemptsTable.id, found.attempt.id));
  }

  return new Response(null, { status: 204 });
}
