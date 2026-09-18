import { NextResponse } from "next/server";

import { getAttemptForCandidate } from "~/server/attempt/access";
import { recordLeft } from "~/server/attempt/service";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "I am closing."
 *
 * Sent as a beacon while the page unloads — the last moment the browser can
 * tell us anything. Without it the server learns about a closed tab only from
 * missing heartbeats, which takes a couple of minutes, and for all of that
 * time the interview shows as running and its duration keeps climbing.
 *
 * It only records the time. Deciding what that means is
 * `sweepAbandonedAttempts` — this same event fires on an ordinary reload, and
 * ending somebody's interview on that evidence would be both wrong and
 * unrecoverable. A tab that comes back clears the mark on its next heartbeat.
 *
 * Nothing is read back, so the body is empty and the response is tiny; a
 * beacon's response is discarded by the browser anyway.
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

  await recordLeft(found.attempt.id);
  return new Response(null, { status: 204 });
}
