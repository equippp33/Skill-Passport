import { NextResponse } from "next/server";

import { getAttemptForCandidate } from "~/server/attempt/access";
import { recordAway } from "~/server/attempt/service";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record that the candidate left the interview tab.
 *
 * Stored on the attempt rather than kept client-side, so it survives a
 * refresh and is visible to the admin reviewing the result.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const { attemptId: raw } = await ctx.params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const found = await getAttemptForCandidate(parsed.data);
  if (!found) return NextResponse.json({ ok: false }, { status: 401 });

  await recordAway(found.attempt.id);
  return NextResponse.json({ ok: true });
}
