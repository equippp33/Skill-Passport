import "server-only";

import { and, eq, notExists, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { interviewAudioTable, interviewTurnsTable } from "~/server/db/schema";
import {
  buildAudioKey,
  deleteAudioObject,
  headAudioObject,
  presignUploadUrl,
  putAudioObject,
} from "./storage";
import { AttemptError } from "~/server/attempt/service";

/**
 * Webcam recording of an answer.
 *
 * Preferred path: the browser PUTs straight to R2 with a presigned URL, so
 * the bytes never touch the app server. That is a cross-origin request, so it
 * only works when the bucket has a CORS rule allowing PUT from the app's
 * origin — without one the preflight is refused and nothing uploads.
 *
 * Because that is external configuration the app cannot make for itself,
 * `relayAnswerVideo` provides a fallback that streams the file through the
 * server instead. Slower and bounded by the platform request-body limit, but
 * it works with no bucket configuration at all. See docs/r2-cors.md.
 *
 * Either way the recording is supplementary — the interview scores from the
 * audio transcript, so a failed camera or a failed upload never blocks
 * progress.
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
 * Drop rows that were reserved but never filled.
 *
 * A row is created before the bytes are sent, so anything that kills the
 * request in between — closing the tab, reloading mid-upload, losing the
 * connection — strands a 0-byte row that is linked to no turn. Clearing
 * them as the next upload starts keeps the attempt's media list honest
 * without needing a sweep job.
 *
 * Only unlinked rows are touched: a linked row always has real bytes behind
 * it, because `finaliseAnswerVideo` is what links it.
 */
async function discardAbandonedUploads(attemptId: string): Promise<void> {
  await db.delete(interviewAudioTable).where(
    and(
      eq(interviewAudioTable.attemptId, attemptId),
      eq(interviewAudioTable.kind, "answer_video"),
      eq(interviewAudioTable.sizeBytes, 0),
      notExists(
        db
          .select({ one: sql`1` })
          .from(interviewTurnsTable)
          .where(eq(interviewTurnsTable.answerVideoId, interviewAudioTable.id)),
      ),
    ),
  );
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
  durationMs?: number | null;
}): Promise<VideoUploadTicket> {
  await requireTurn(input);
  await discardAbandonedUploads(input.attemptId);

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
    durationMs: input.durationMs ?? null,
    storageKey: key,
  });

  const uploadUrl = await presignUploadUrl({
    key,
    contentType: input.mimeType,
  });
  return { videoId, uploadUrl };
}

/**
 * Fallback upload: take the bytes from the browser and write them to R2 here.
 *
 * Used when the direct presigned PUT could not run — in practice, when the
 * bucket has no CORS rule for this origin. The row was already reserved by
 * `createAnswerVideoUpload`, so this only fills in the object it points at
 * and then goes through the same verify-and-link step as the direct path.
 */
export async function relayAnswerVideo(input: {
  attemptId: string;
  turnNumber: number;
  videoId: string;
  body: Buffer;
}): Promise<{ linked: boolean }> {
  await requireTurn(input);

  const row = await db.query.interviewAudioTable.findFirst({
    where: and(
      eq(interviewAudioTable.id, input.videoId),
      eq(interviewAudioTable.attemptId, input.attemptId),
    ),
  });
  if (!row) return { linked: false };

  // Checked here as well as at the route, because the row's own key is what
  // decides how much we are willing to store.
  if (input.body.byteLength === 0 || input.body.byteLength > MAX_VIDEO_BYTES) {
    await db
      .delete(interviewAudioTable)
      .where(eq(interviewAudioTable.id, row.id));
    return { linked: false };
  }

  await putAudioObject({
    key: row.storageKey,
    body: input.body,
    mimeType: row.mimeType,
  });

  return finaliseAnswerVideo(input);
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
