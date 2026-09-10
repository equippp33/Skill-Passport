import { NextResponse } from "next/server";

import { getAttemptForCandidate } from "~/server/attempt/access";
import { AttemptError } from "~/server/attempt/service";
import {
  MAX_VIDEO_BYTES,
  createAnswerVideoUpload,
  finaliseAnswerVideo,
  normaliseVideoMimeType,
  relayAnswerVideo,
} from "~/server/interview/video";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webcam upload:
 *   POST  -> reserve a row, return a presigned PUT URL
 *   PATCH -> verify the object, enforce the cap, link it to the turn
 *   PUT   -> fallback: send the bytes through here instead
 *
 * The fast path is browser -> R2 directly, which needs a CORS rule on the
 * bucket. PUT exists for when that rule is absent: the bytes come through
 * the server, subject to the platform request-body limit.
 *
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
    durationMs?: unknown;
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
    // Cosmetic, browser-supplied: a nonsense value is dropped rather than
    // failing an upload the interview does not depend on.
    const declared = Number(body?.durationMs);
    const durationMs =
      Number.isFinite(declared) && declared > 0 && declared < 3_600_000
        ? Math.round(declared)
        : null;

    const ticket = await createAnswerVideoUpload({
      attemptId: found.attempt.id,
      turnNumber,
      mimeType,
      durationMs,
    });
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Relay the recording through the server.
 *
 * Identifiers travel in the query string so the whole body can be the file —
 * no multipart parse of a video-sized payload.
 */
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const found = await resolveAttempt(ctx.params);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 401 });
  }

  const url = new URL(request.url);
  const turnNumber = turnNumberFrom(url.searchParams.get("turnNumber"));
  const videoId = uuidSchema.safeParse(url.searchParams.get("videoId"));
  if (turnNumber === null || !videoId.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Reject an oversized upload on the declared length before reading it, so
  // a large body is not buffered only to be thrown away.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Video too large." }, { status: 413 });
  }

  try {
    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "Video too large." }, { status: 413 });
    }

    const result = await relayAnswerVideo({
      attemptId: found.attempt.id,
      turnNumber,
      videoId: videoId.data,
      body,
    });
    return NextResponse.json(result);
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
