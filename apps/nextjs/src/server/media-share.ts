import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "~/env";

/**
 * Anonymous, link-shareable access tokens.
 *
 * A token is an HMAC of some id — a clip's audio id, or an attempt id for a
 * shared report — with `MEDIA_SHARE_SECRET`. It is unguessable and scoped to
 * that one id, so a link in a shared document opens exactly that one thing,
 * with no account, while the recordings bucket stays private. These are the
 * only anonymous doors, and each opens one id at a time.
 *
 * No expiry on purpose: a shared report link is meant to keep working. To
 * revoke every shared link at once, rotate `MEDIA_SHARE_SECRET`.
 *
 * The 16-byte (128-bit) HMAC is plenty to be unguessable and keeps the URL
 * short. Must stay byte-for-byte in step with any external signer that mints
 * the same links.
 */
function digest(id: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(id).digest().subarray(0, 16);
}

/** Token for an id, or null when sharing is not configured. */
export function signShareId(id: string): string | null {
  const secret = env.MEDIA_SHARE_SECRET;
  if (!secret) return null;
  return digest(id, secret).toString("base64url");
}

/** Constant-time check that `token` authorises `id`. */
export function verifyShareToken(
  id: string,
  token: string | null | undefined,
): boolean {
  const secret = env.MEDIA_SHARE_SECRET;
  if (!secret || !token) return false;

  const provided = Buffer.from(token, "base64url");
  const expected = digest(id, secret);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
