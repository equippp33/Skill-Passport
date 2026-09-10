/**
 * Where a "back" link is allowed to point.
 *
 * The candidate report carries the URL of the dialog it was opened from, so
 * going back lands on the interview the admin was looking at. That value
 * comes off the address bar, so it is checked rather than trusted: without
 * this, `?from=//evil.example` would render as a link out of the app that
 * looks like part of it.
 *
 * Only a path inside the admin area is accepted. Anything else falls back
 * rather than erroring, because a bad `from` is a broken link, not a broken
 * page.
 */

/**
 * Control characters, which can break out of an HTML attribute.
 *
 * Written as a code check rather than a regex literal: the range is made of
 * unprintable characters, and a source file is the wrong place to keep
 * those where a stray copy-paste can silently change them.
 */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeReturnTo(
  from: string | undefined,
  fallback = "/admin/interviews",
): string {
  if (!from || hasControlCharacters(from)) return fallback;

  // `//host` is protocol-relative and leaves the site; some browsers treat
  // `/\host` the same way. Both begin with a slash, so a prefix check on its
  // own would wave them through.
  if (from.startsWith("//") || from.startsWith("/\\")) return fallback;

  // Exact segment match, so `/adminsomething.evil` is not mistaken for a
  // path inside `/admin`.
  const inAdmin =
    from === "/admin" ||
    from.startsWith("/admin/") ||
    from.startsWith("/admin?");

  return inAdmin ? from : fallback;
}
