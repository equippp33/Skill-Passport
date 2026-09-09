import { NextResponse } from "next/server";

import { getAuth } from "~/server/auth/session";
import {
  getAttemptForCandidate,
  readAttemptCookie,
} from "~/server/attempt/access";
import {
  loadAudioForAdmin,
  loadAudioForAttempt,
} from "~/server/interview/audio";
import {
  PLAYBACK_URL_TTL_SECONDS,
  presignAudioUrl,
} from "~/server/interview/storage";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a stored clip — question audio, or a recorded answer.
 *
 * Two callers, two proofs of access, no anonymous path:
 *  - the candidate, via their attempt cookie (`?attempt=` names which one);
 *  - an admin, via a join proving they created the parent interview.
 *
 * Ownership is enforced inside the query, then the request is redirected to a
 * short-lived presigned R2 URL rather than proxying bytes through the app.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ audioId: string }> },
): Promise<Response> {
  const { audioId: raw } = await ctx.params;
  const audioId = uuidSchema.safeParse(raw);
  if (!audioId.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let audio: { storageKey: string } | null = null;

  const attemptParam = new URL(request.url).searchParams.get("attempt");
  if (attemptParam && (await readAttemptCookie())) {
    const parsedAttempt = uuidSchema.safeParse(attemptParam);
    if (parsedAttempt.success) {
      const found = await getAttemptForCandidate(parsedAttempt.data);
      if (found) {
        audio = await loadAudioForAttempt(audioId.data, found.attempt.id);
      }
    }
  }

  if (!audio) {
    const { user } = await getAuth();
    if (user) audio = await loadAudioForAdmin(audioId.data, user.id);
  }

  // Another candidate's clip is indistinguishable from a missing one.
  if (!audio) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let url: string;
  try {
    url = await presignAudioUrl(audio.storageKey);
  } catch {
    return NextResponse.json(
      { error: "Audio is temporarily unavailable." },
      { status: 503 },
    );
  }

  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      "Cache-Control": `private, max-age=${Math.floor(
        PLAYBACK_URL_TTL_SECONDS / 2,
      )}`,
    },
  });
}
