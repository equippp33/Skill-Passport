import { NextResponse } from "next/server";

import { getAttemptForCandidate } from "~/server/attempt/access";
import { AttemptError } from "~/server/attempt/service";
import {
  createAnswerVideoUpload,
  finaliseAnswerVideo,
  normaliseVideoMimeType,
} from "~/server/interview/video";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webcam upload, in two steps:
 *   POST  -> reserve a row, return a presigned PUT URL
 *   PATCH -> verify the object, enforce the cap, link it to the turn
 *
 * Bytes go browser -> R2 directly, so the request-body limit never applies.
 * Video is supplementary: failures here never block the interview.
 */
async function resolveAttempt(params: Promise<{ attemptId: string }>) {
  const { attemptId: raw } = await params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) return null;
  return getAttemptForCandidate(parsed.data);
}

function turnNumberFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function handleError(error: unknown): NextResponse {
  if (error instanceof AttemptError) {
    return NextResponse.json(
      { error: error.userMessage },
      { status: error.code === "not_found" ? 404 : 400 },
    );
  }
  console.error("[attempt] answer video failed", error);
  return NextResponse.json(
    { error: "Video could not be saved." },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const found = await resolveAttempt(ctx.params);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    turnNumber?: unknown;
    mimeType?: unknown;
  } | null;

  const turnNumber = turnNumberFrom(body?.turnNumber);
  if (turnNumber === null) {
    return NextResponse.json({ error: "Invalid question." }, { status: 400 });
  }

  const mimeType = normaliseVideoMimeType(
    typeof body?.mimeType === "string" ? body.mimeType : "",
  );
  if (!mimeType) {
    return NextResponse.json(
      { error: "That video format is not supported." },
      { status: 400 },
    );
  }

  try {
    const ticket = await createAnswerVideoUpload({
      attemptId: found.attempt.id,
      turnNumber,
      mimeType,
    });
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const found = await resolveAttempt(ctx.params);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    turnNumber?: unknown;
    videoId?: unknown;
  } | null;

  const turnNumber = turnNumberFrom(body?.turnNumber);
  const videoId = uuidSchema.safeParse(body?.videoId);
  if (turnNumber === null || !videoId.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await finaliseAnswerVideo({
      attemptId: found.attempt.id,
      turnNumber,
      videoId: videoId.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
