import { z } from "zod";

import { WORK_SKILL_COUNT } from "~/config/work-skills";

/**
 * Shared client/server validation contract.
 *
 * This module must stay free of `server-only` imports: the same schemas run in
 * the browser for inline form feedback and on the server as the authoritative
 * check. The server never trusts the client having run them.
 */

/**
 * The assessment is fixed: one question per work skill, no setup step.
 * Nothing is collected from the candidate before it starts.
 */
export const DEFAULT_QUESTION_COUNT = WORK_SKILL_COUNT;

/**
 * Answer recording limits. Declared here (not in the server-only audio module)
 * so the client and the server share one definition — the client uses them for
 * UX, the server re-checks them as the real enforcement.
 */
export const MAX_ANSWER_SECONDS = 120;
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
export const MIN_ANSWER_BYTES = 1024;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(255)
    .email("Enter a valid email address.")
    .transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(200, "Password is too long."),
});

/**
 * Sign-up takes exactly the same fields as sign-in: email and password.
 * Declared separately so the two can diverge (password strength rules, terms
 * acceptance) without weakening the login check.
 */
export const signupSchema = loginSchema;

/** UUID guard for route params before they ever reach a query. */
export const uuidSchema = z.string().uuid();
