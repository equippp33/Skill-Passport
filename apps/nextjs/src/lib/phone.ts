/**
 * Indian mobile numbers, as people actually type them.
 *
 * Two callers with deliberately different endings, sharing one idea of what
 * the digits are:
 *
 *  - the input box normalises as you type, so an eleventh digit simply
 *    cannot be entered and a pasted "+91 98765 43210" becomes the ten
 *    digits it means;
 *  - the server VALIDATES, and rejects anything that is not exactly ten.
 *
 * The server must not share the truncating behaviour: silently cutting a
 * 17-digit number down to 10 would store a plausible-looking number that
 * nobody owns.
 */

/**
 * Strip separators, and a country or trunk prefix when one is clearly
 * present. `+91 98765 43210` and `098765 43210` both mean the same ten
 * digits; a bare eleven- or twelve-digit number that does not start with
 * those prefixes is left alone, so the caller can reject it.
 */
export function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** Exactly ten digits, no separators. */
export const PHONE_DIGITS = 10;

/**
 * What the input should show after each keystroke or paste.
 *
 * Capped, so the field cannot hold a number the server would reject —
 * the prefix is removed before the cap, or `+91 98765 43210` would be
 * truncated to `9198765432`.
 */
export function normalisePhoneInput(raw: string): string {
  return phoneDigits(raw).slice(0, PHONE_DIGITS);
}
