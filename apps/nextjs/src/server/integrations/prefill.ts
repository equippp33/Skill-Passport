import "server-only";

/**
 * Pre-fill for the candidate start form, carried in the `?p=` query param of an
 * integration link.
 *
 * Language is deliberately NOT here — the student always picks that themselves
 * on the start form. And it is deliberately NOT signed: the interview is already
 * publicly startable via its token, and every field below is editable on the
 * form, so a signature would protect nothing. This is a convenience, not a
 * credential.
 */
export interface StartPrefill {
  name?: string;
  email?: string;
  phone?: string;
  course?: string;
  /** The partner's student id, carried through so the result can be posted back
   *  keyed to their record. Not shown as an editable field. */
  studentId?: string;
}

/** Pack prefill into a compact, URL-safe blob (base64url, no padding). */
export function encodePrefill(data: StartPrefill): string {
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

/**
 * Decode a `?p=` blob back to prefill, or null when it is missing or garbage.
 * Never throws — a bad blob simply means an empty form.
 */
export function decodePrefill(
  blob: string | null | undefined,
): StartPrefill | null {
  if (!blob) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(blob, "base64url").toString("utf8"),
    );
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
