import { z } from "zod";

import { PHONE_DIGITS, phoneDigits } from "~/lib/phone";

import { WORK_SKILL_COUNT } from "~/config/work-skills";
import { INTERVIEW_LANGUAGE_KEYS } from "~/config/languages";

/**
 * Shared client/server validation contract.
 *
 * This module must stay free of `server-only` imports: the same schemas run in
 * the browser for inline form feedback and on the server as the authoritative
 * check. The server never trusts the client having run them.
 */

/**
 * One primary question per work skill. Follow-ups are no longer scheduled by
 * this count — they are inserted dynamically, only for the skills an admin
 * marked follow-up-eligible and only when the answer is worth digging into.
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

/**
 * The details a candidate gives before starting.
 *
 * Lives here rather than beside the action because a `"use server"` module
 * may only export async functions, and this is the sort of rule that should
 * be pinned down by tests.
 */
export const candidateDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "Keep your name under 120 characters."),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Enter a valid email address.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v.toLowerCase() : null)),
  /**
   * Exactly ten digits.
   *
   * Separators and a leading +91 or 0 are stripped rather than rejected,
   * because that is how people actually type a number — refusing
   * "98765 43210" would be pedantry, not validation. Anything that is not
   * ten digits after that is rejected rather than trimmed: quietly cutting
   * a long number down to ten would store one nobody owns.
   */
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (!v) return null;
      const digits = phoneDigits(v);
      return digits.length > 0 ? digits : null;
    })
    .refine((v) => v === null || v.length === PHONE_DIGITS, {
      message: "Enter a 10-digit phone number.",
    }),
  /**
   * The interview language, chosen up front and fixed for the whole interview.
   * One of the supported interview languages; the whole session — questions,
   * speech, transcription — runs in it, with no mid-interview switching.
   */
  language: z.enum(INTERVIEW_LANGUAGE_KEYS as [string, ...string[]], {
    message: "Choose the language for your interview.",
  }),
  /** Course / field of study, used to ground and pre-prepare questions. */
  course: z
    .string()
    .trim()
    .max(120, "Keep the course under 120 characters.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  /**
   * Partner student id, carried through as a hidden field on integration
   * links. Absent for ordinary candidates; never shown or validated for the
   * candidate, only stored so their result can be posted back.
   */
  studentId: z
    .string()
    .trim()
    .max(128)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
});
