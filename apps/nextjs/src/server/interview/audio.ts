import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  MAX_ANSWER_BYTES,
  MAX_ANSWER_SECONDS,
  MIN_ANSWER_BYTES,
} from "./validation";
import {
  interviewAttemptsTable,
  interviewAudioTable,
  interviewsTable,
} from "~/server/db/schema";
import {
  buildAudioKey,
  deleteAudioObject,
  getAudioObject,
  putAudioObject,
} from "./storage";

export { MAX_ANSWER_BYTES, MAX_ANSWER_SECONDS, MIN_ANSWER_BYTES };

/**
 * Audio storage.
 *
 * Bytes live in Cloudflare R2 (see `./storage.ts`); this module owns the
 * database row that points at them, plus the ownership checks around it.
 *
 * Recordings are private: the bucket has no public access. Playback goes
 * through `/api/interview/audio/[audioId]`, which verifies ownership and then
 * redirects to a short-lived presigned URL.
 */

/**
 * Container formats MediaRecorder realistically produces, all of which Sarvam
 * STT accepts. Codec parameters (`;codecs=opus`) are stripped before matching.
 */
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
]);

export function normaliseMimeType(raw: string): string {
  return (raw.split(";")[0] ?? "").trim().toLowerCase();
}

export interface AudioValidationResult {
  ok: boolean;
  /** Safe to show to the candidate. */
  error?: string;
  mimeType?: string;
}

/** Server-side validation of an uploaded recording. Never trust the client. */
export function validateAnswerAudio(
  bytes: number,
  rawMimeType: string,
): AudioValidationResult {
  const mimeType = normaliseMimeType(rawMimeType);

  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      error:
        "That audio format is not supported. Please re-record using a different browser.",
    };
  }
  if (bytes < MIN_ANSWER_BYTES) {
    return {
      ok: false,
      error:
        "That recording is empty or too short. Please record your answer again.",
    };
  }
  if (bytes > MAX_ANSWER_BYTES) {
    return {
      ok: false,
      error: `That recording is too large (limit ${Math.floor(
        MAX_ANSWER_BYTES / (1024 * 1024),
      )} MB). Please keep answers under ${MAX_ANSWER_SECONDS} seconds.`,
    };
  }
  return { ok: true, mimeType };
}

/**
 * Upload to R2, then record the pointer.
 *
 * Order matters: the object is written first, so a committed row can never
 * reference a missing object. The reverse (orphan object, no row) is harmless
 * and is cleaned up below.
 */
export async function storeAudio(input: {
  attemptId: string;
  kind: "question" | "answer";
  mimeType: string;
  data: Buffer;
  /** Recorded length, when the recorder measured one. */
  durationMs?: number | null;
}): Promise<string> {
  const audioId = crypto.randomUUID();
  const key = buildAudioKey({
    attemptId: input.attemptId,
    audioId,
    kind: input.kind,
    mimeType: input.mimeType,
  });

  await putAudioObject({ key, body: input.data, mimeType: input.mimeType });

  try {
    const [row] = await db
      .insert(interviewAudioTable)
      .values({
        id: audioId,
        attemptId: input.attemptId,
        kind: input.kind,
        mimeType: input.mimeType,
        sizeBytes: input.data.byteLength,
        durationMs: input.durationMs ?? null,
        storageKey: key,
      })
      .returning({ id: interviewAudioTable.id });

    if (!row) throw new Error("Failed to persist interview audio row");
    return row.id;
  } catch (error) {
    // Never leave an orphan object behind if the row could not be written.
    await deleteAudioObject(key);
    throw error;
  }
}

/**
 * Load an audio row. `attemptId` is part of the predicate so a valid
 * audio id from another candidate's interview can never be read.
 */
export async function loadAudio(input: { audioId: string; attemptId: string }) {
  return db.query.interviewAudioTable.findFirst({
    where: and(
      eq(interviewAudioTable.id, input.audioId),
      eq(interviewAudioTable.attemptId, input.attemptId),
    ),
  });
}

/** Fetch the actual bytes for a stored clip. Used by transcription. */
export async function loadAudioBytes(input: {
  audioId: string;
  attemptId: string;
}): Promise<{ data: Buffer; mimeType: string } | null> {
  const row = await loadAudio(input);
  if (!row) return null;

  const data = await getAudioObject(row.storageKey);
  if (!data) return null;

  return { data, mimeType: row.mimeType };
}

/**
 * Load a clip for the candidate who owns the attempt.
 *
 * The attempt id comes from the verified cookie, never the URL, so a guessed
 * audio id from someone else's attempt returns nothing.
 */
export async function loadAudioForAttempt(audioId: string, attemptId: string) {
  const rows = await db
    .select({
      id: interviewAudioTable.id,
      kind: interviewAudioTable.kind,
      mimeType: interviewAudioTable.mimeType,
      storageKey: interviewAudioTable.storageKey,
    })
    .from(interviewAudioTable)
    .where(
      and(
        eq(interviewAudioTable.id, audioId),
        eq(interviewAudioTable.attemptId, attemptId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Load a clip for an admin reviewing an attempt.
 *
 * Ownership is proved by the join: audio -> attempt -> interview -> creator.
 * An admin can only hear recordings from interviews they created.
 */
export async function loadAudioForAdmin(audioId: string, adminId: string) {
  const rows = await db
    .select({
      id: interviewAudioTable.id,
      kind: interviewAudioTable.kind,
      mimeType: interviewAudioTable.mimeType,
      storageKey: interviewAudioTable.storageKey,
    })
    .from(interviewAudioTable)
    .innerJoin(
      interviewAttemptsTable,
      eq(interviewAudioTable.attemptId, interviewAttemptsTable.id),
    )
    .innerJoin(
      interviewsTable,
      eq(interviewAttemptsTable.interviewId, interviewsTable.id),
    )
    .where(
      and(
        eq(interviewAudioTable.id, audioId),
        eq(interviewsTable.createdByUserId, adminId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** In-app URL for a stored clip. Served by the authenticated route handler. */
export function audioUrl(audioId: string | null): string | null {
  return audioId ? `/api/interview/audio/${audioId}` : null;
}
