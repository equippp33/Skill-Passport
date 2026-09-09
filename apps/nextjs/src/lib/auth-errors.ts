/**
 * Auth error helpers shared by the server action, the form and the tests.
 *
 * Deliberately NOT in `actions.ts`: a `"use server"` module may only export
 * async functions, so a plain constant or predicate there is a build error.
 * Also free of server-only imports, so the Client Component can read the
 * sentinel.
 */

/**
 * Sentinel returned instead of a message, so the page decides which language
 * to render it in. Server actions never import the UI dictionary.
 */
export const EMAIL_TAKEN = "__email_taken__";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/**
 * Detect a unique-constraint failure.
 *
 * Drizzle wraps driver errors in its own `Error: Failed query: …` and hangs
 * the original off `cause`, so the code is not on the top-level object — walk
 * the chain rather than checking only the surface.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return false;
}
