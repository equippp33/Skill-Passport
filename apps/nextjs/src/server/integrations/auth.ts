import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of the `Authorization: Bearer <key>` header against the
 * shared integration key, so the key cannot be recovered by timing. Shared by
 * every integration endpoint.
 */
export function bearerAuthorised(request: Request, key: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
