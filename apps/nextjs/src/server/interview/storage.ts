import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "~/env";
import { ProviderError } from "~/server/services/errors";

/**
 * Cloudflare R2 object storage for interview audio.
 *
 * Privacy note: recordings live in a dedicated PRIVATE bucket with no public
 * access. Playback always goes through `/api/interview/audio/[audioId]`,
 * which checks ownership and then issues a presigned URL valid for
 * PLAYBACK_URL_TTL_SECONDS. Keys are UUID-based, but the authenticated route
 * is the actual access control — do not enable public access on the bucket.
 */

/** Presigned playback URLs are deliberately short-lived. */
export const PLAYBACK_URL_TTL_SECONDS = 300;

/** Upload URLs live just long enough to finish one recording. */
export const UPLOAD_URL_TTL_SECONDS = 600;

let client: S3Client | null = null;

function getClient(): S3Client {
  client ??= new S3Client({
    // R2 ignores region but the SDK requires one.
    region: "auto",
    endpoint: env.CLOUDFLARE_R2_ENDPOINT,
    credentials: {
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "video/webm":
      return "webm";
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
}

/**
 * Object key layout:
 *   <prefix>/interviews/<sessionId>/<question|answer>/<audioId>.<ext>
 * Grouping by session keeps cleanup and manual inspection simple.
 */
export function buildAudioKey(input: {
  attemptId: string;
  audioId: string;
  kind: "question" | "answer" | "answer_video";
  mimeType: string;
}): string {
  return [
    env.CLOUDFLARE_R2_PREFIX,
    "interviews",
    input.attemptId,
    input.kind,
    `${input.audioId}.${extensionFor(input.mimeType)}`,
  ].join("/");
}

function storageError(operation: string, error: unknown): ProviderError {
  console.error(
    `[r2] ${operation} failed: ${
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown"
    }`,
  );
  return new ProviderError({
    provider: "sarvam", // storage failures surface on the same UI path
    message: `r2 ${operation} failed`,
    userMessage:
      "We could not save your recording. Please check your connection and try again.",
    retryable: true,
  });
}

export async function putAudioObject(input: {
  key: string;
  body: Buffer;
  mimeType: string;
}): Promise<void> {
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: input.key,
        Body: input.body,
        ContentType: input.mimeType,
        ContentLength: input.body.byteLength,
        // Belt and braces alongside the authenticated playback route.
        CacheControl: "private, max-age=0, no-store",
      }),
    );
  } catch (error) {
    throw storageError("putObject", error);
  }
}

/** Fetch the bytes back — used by the transcription step. */
export async function getAudioObject(key: string): Promise<Buffer | null> {
  try {
    const result = await getClient().send(
      new GetObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: key,
      }),
    );
    if (!result.Body) return null;
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    // A missing object is a real state, not a transport failure.
    if (status === 404) return null;
    throw storageError("getObject", error);
  }
}

/** Short-lived URL the browser can play directly from R2. */
export async function presignAudioUrl(key: string): Promise<string> {
  try {
    return await getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: key,
      }),
      { expiresIn: PLAYBACK_URL_TTL_SECONDS },
    );
  } catch (error) {
    throw storageError("presign", error);
  }
}

/**
 * Presigned PUT so the browser can upload straight to R2.
 *
 * Webcam recordings are far larger than the platform request-body limit, so
 * they must not pass through the app server. The URL is short-lived and
 * scoped to one exact key.
 */
export async function presignUploadUrl(input: {
  key: string;
  contentType: string;
}): Promise<string> {
  try {
    return await getSignedUrl(
      getClient(),
      new PutObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
  } catch (error) {
    throw storageError("presignUpload", error);
  }
}

/** Actual stored size, used to enforce the cap after a direct upload. */
export async function headAudioObject(
  key: string,
): Promise<{ sizeBytes: number } | null> {
  try {
    const result = await getClient().send(
      new HeadObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: key,
      }),
    );
    return { sizeBytes: result.ContentLength ?? 0 };
  } catch {
    // Missing object is a normal outcome: the browser upload may have failed.
    return null;
  }
}

/** Best-effort cleanup; never fails the caller. */
export async function deleteAudioObject(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: key,
      }),
    );
  } catch (error) {
    console.error(
      `[r2] deleteObject failed for key: ${
        error instanceof Error ? error.name : "unknown"
      }`,
    );
  }
}
