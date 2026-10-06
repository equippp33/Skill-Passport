import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { env } from "~/env";

/**
 * Pre-fill for the candidate start form, carried in the `?p=` query param of an
 * integration link.
 *
 * ENCRYPTED, not just encoded. The blob holds the student's name/email/phone —
 * PII that must not be readable from a leaked URL (history, referrers, logs,
 * screenshots). AES-256-GCM keeps it confidential AND tamper-proof; only our
 * server can read it. The key is derived from `INTEGRATION_API_KEY` (known only
 * to us and the partner who sent the data), so there is no extra secret and no
 * database row to carry it.
 *
 * Language is deliberately NOT here — the student always picks that on the form.
 */
export interface StartPrefill {
  name?: string;
  email?: string;
  phone?: string;
  course?: string;
  /** Partner student id (student_uuid), echoed back with the result. */
  studentId?: string;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 32-byte AES key derived from the shared integration secret, or null if unset. */
function prefillKey(): Buffer | null {
  const secret = env.INTEGRATION_API_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

/** Encrypt prefill into a compact, URL-safe token. Throws if no key is set. */
export function encodePrefill(data: StartPrefill): string {
  const key = prefillKey();
  if (!key) {
    throw new Error("INTEGRATION_API_KEY is required to build an integration link");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

/**
 * Decrypt a `?p=` token back to prefill, or null when it is missing, tampered,
 * or unreadable (wrong key). Never throws — a bad token just means an empty form.
 */
export function decodePrefill(
  blob: string | null | undefined,
): StartPrefill | null {
  const key = prefillKey();
  if (!key || !blob) return null;
  try {
    const raw = Buffer.from(blob, "base64url");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    const str = (v: unknown) =>
      typeof v === "string" && v.length > 0 ? v.slice(0, 255) : undefined;
    return {
      name: str(p.name),
      email: str(p.email),
      phone: str(p.phone),
      course: str(p.course),
      studentId: str(p.studentId),
    };
  } catch {
    return null;
  }
}
