import { NextResponse, after } from "next/server";

import {
  MAX_ANSWER_BYTES,
  validateAnswerAudio,
} from "~/server/interview/audio";
import { getAttemptForCandidate } from "~/server/attempt/access";
import {
  AttemptError,
  processTurn,
  submitAnswer,
} from "~/server/attempt/service";
import { MAX_ANSWER_SECONDS, uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit a recorded answer.
 *
 * Returns as soon as the turn is claimed and the audio is stored (202). The
 * transcribe -> detect language -> evaluate -> synthesise pipeline then runs
 * via `after()`, outside the response, and the client polls `/status`.
 *
 * Access is the attempt cookie, not a login: candidates have no account.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const { attemptId: raw } = await ctx.params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const found = await getAttemptForCandidate(parsed.data);
  if (!found) {
    return NextResponse.json(
      { error: "This interview session has expired. Open your link again." },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "That upload could not be read. Please try again." },
      { status: 400 },
    );
  }

  const files = formData.getAll("audio").filter((f) => f instanceof File);
  const file = files[0];
  const turnNumber = Number(formData.get("turnNumber"));
  // Recorded length, measured in the browser. Untrusted and cosmetic — it
  // labels the clip for the admin, so a bad value is dropped, not rejected.
  const declaredDuration = Number(formData.get("durationMs"));
  const durationMs =
    Number.isFinite(declaredDuration) &&
    declaredDuration > 0 &&
    declaredDuration <= MAX_ANSWER_SECONDS * 1000 * 2
      ? Math.round(declaredDuration)
      : null;

  if (!file) {
    return NextResponse.json(
      { error: "No recording was attached." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    return NextResponse.json({ error: "Invalid question." }, { status: 400 });
  }
  // Check declared sizes before buffering anything into memory.
  const declaredTotal = files.reduce((sum, f) => sum + f.size, 0);
  if (declaredTotal > MAX_ANSWER_BYTES) {
    return NextResponse.json(
      { error: "That recording is too large. Please keep answers shorter." },
      { status: 413 },
    );
  }

  const segments = await Promise.all(
    files.map(async (f) => Buffer.from(await f.arrayBuffer())),
  );

  // Validated on the total: a long answer arrives as several segments, and
  // the last one can be a fraction of a second on its own.
  const totalBytes = segments.reduce((sum, b) => sum + b.byteLength, 0);
  const validation = validateAnswerAudio(totalBytes, file.type);
  if (!validation.ok || !validation.mimeType) {
    return NextResponse.json(
      { error: validation.error ?? "That recording could not be used." },
      { status: 400 },
    );
  }

  // Hoisted so the narrowing above survives into the `after()` closure.
  const mimeType = validation.mimeType;

  try {
    const result = await submitAnswer({
      attempt: found.attempt,
      turnNumber,
      mimeType,
    });

    // Only the request that actually claimed the turn schedules the work.
    if (result.status === "processing") {
      after(async () => {
        // The bytes go with it: transcription and archiving both happen
        // out here, so neither is on the path the candidate waits on.
        await processTurn(found.attempt.id, result.turnId, found.interview, {
          segments,
          mimeType,
          durationMs,
        });
      });
    }

    return NextResponse.json({ status: "processing" }, { status: 202 });
  } catch (error) {
    if (error instanceof AttemptError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "invalid_state"
            ? 409
            : 400;
      return NextResponse.json({ error: error.userMessage }, { status });
    }
    console.error("[attempt] answer upload failed", error);
    return NextResponse.json(
      { error: "We could not accept that answer. Please try again." },
      { status: 500 },
    );
  }
}
