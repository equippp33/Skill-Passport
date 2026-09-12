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
  getAudioObject,
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
 * Ownership is enforced inside the query. What happens next depends on what
 * is being fetched:
 *
 *  - QUESTION audio is served from here. It is small, it is on the critical
 *    path — the candidate is waiting to hear it — and a redirect costs a
 *    second round trip plus a fresh TLS handshake to R2. Worse, a presigned
 *    URL is unique every time, so the browser can never reuse one: `preload`
 *    and any warming are wasted. Serving the bytes from a stable URL makes
 *    the clip cacheable, which is what lets the next question be fetched
 *    before it is needed.
 *  - Everything else is REDIRECTED to a presigned URL as before. Recordings
 *    are far larger, and `<video>` seeking depends on range requests that R2
 *    answers natively and this route would have to reimplement.
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

  let audio: {
    kind: string;
    mimeType: string;
    storageKey: string;
  } | null = null;

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

  if (audio.kind === "question") {
    try {
      const bytes = await getAudioObject(audio.storageKey);
      if (!bytes) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": audio.mimeType,
          "Content-Length": String(bytes.byteLength),
          // A clip is written once under a uuid key and never changes, so
          // this is safe to keep. `private` because the URL is scoped to
          // one candidate's attempt.
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json(
        { error: "Audio is temporarily unavailable." },
        { status: 503 },
      );
    }
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
