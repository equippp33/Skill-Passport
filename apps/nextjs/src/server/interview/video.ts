import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { interviewAudioTable, interviewTurnsTable } from "~/server/db/schema";
import {
  buildAudioKey,
  deleteAudioObject,
  headAudioObject,
  presignUploadUrl,
} from "./storage";
import { AttemptError } from "~/server/attempt/service";

/**
 * Webcam recording of an answer.
 *
 * Video never passes through the app server: it is an order of magnitude
 * larger than the audio and would exceed the platform request-body limit. The
 * browser uploads straight to R2 with a presigned PUT, then calls back so the
 * server can verify the real size and link it to the turn.
 *
 * It is deliberately supplementary — the interview scores from the audio
 * transcript, so a failed camera or a failed upload never blocks progress.
 */

/** Generous: 120s of 480p VP8 lands well under this. */
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/webm", "video/mp4"]);

export function normaliseVideoMimeType(raw: string): string | null {
  const type = (raw.split(";")[0] ?? "").trim().toLowerCase();
  return ALLOWED_VIDEO_MIME_TYPES.has(type) ? type : null;
}

/** The turn a video belongs to, scoped to the verified attempt. */
async function requireTurn(input: { attemptId: string; turnNumber: number }) {
  const rows = await db
    .select({ id: interviewTurnsTable.id })
    .from(interviewTurnsTable)
    .where(
      and(
        eq(interviewTurnsTable.attemptId, input.attemptId),
        eq(interviewTurnsTable.turnNumber, input.turnNumber),
      ),
    )
    .limit(1);

  const turn = rows[0];
  if (!turn) {
    throw new AttemptError("not_found", "That question could not be found.");
  }
  return turn;
}

export interface VideoUploadTicket {
  videoId: string;
  uploadUrl: string;
}

/**
 * Reserve a row and hand back a presigned PUT URL.
 *
 * `sizeBytes` starts at 0 and is filled in by `finaliseAnswerVideo` from the
 * object itself — the browser's claim about size is never trusted.
 */
export async function createAnswerVideoUpload(input: {
  attemptId: string;
  turnNumber: number;
  mimeType: string;
}): Promise<VideoUploadTicket> {
  await requireTurn(input);

  const videoId = crypto.randomUUID();
  const key = buildAudioKey({
    attemptId: input.attemptId,
    audioId: videoId,
    kind: "answer_video",
    mimeType: input.mimeType,
  });

  await db.insert(interviewAudioTable).values({
    id: videoId,
    attemptId: input.attemptId,
    kind: "answer_video",
    mimeType: input.mimeType,
    sizeBytes: 0,
    storageKey: key,
  });

  const uploadUrl = await presignUploadUrl({
    key,
    contentType: input.mimeType,
  });
  return { videoId, uploadUrl };
}

/**
 * Confirm the upload landed, enforce the size cap, and attach it to the turn.
 * An oversized or missing object is discarded rather than linked.
 */
export async function finaliseAnswerVideo(input: {
  attemptId: string;
  turnNumber: number;
  videoId: string;
}): Promise<{ linked: boolean }> {
  const turn = await requireTurn(input);

  const row = await db.query.interviewAudioTable.findFirst({
    where: and(
      eq(interviewAudioTable.id, input.videoId),
      eq(interviewAudioTable.attemptId, input.attemptId),
    ),
  });
  if (!row) return { linked: false };

  const head = await headAudioObject(row.storageKey);
  if (!head || head.sizeBytes === 0 || head.sizeBytes > MAX_VIDEO_BYTES) {
    await deleteAudioObject(row.storageKey);
    await db
      .delete(interviewAudioTable)
      .where(eq(interviewAudioTable.id, row.id));
    return { linked: false };
  }

  await db
    .update(interviewAudioTable)
    .set({ sizeBytes: head.sizeBytes })
    .where(eq(interviewAudioTable.id, row.id));

  await db
    .update(interviewTurnsTable)
    .set({ answerVideoId: row.id, updatedAt: new Date() })
    .where(eq(interviewTurnsTable.id, turn.id));

  return { linked: true };
}
