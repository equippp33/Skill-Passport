import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "~/env";
import { absoluteUrl } from "~/server/app-url";
import { encodePrefill } from "~/server/integrations/prefill";

export const dynamic = "force-dynamic";

/**
 * Partner integration: turn a student's details into a ready-to-open interview
 * link the partner site can show them.
 *
 * The partner POSTs the student's details with the shared bearer key; we return
 * a link to the ONE configured interview (room) with those details pre-filled.
 * Nothing is created here — the attempt only exists once the student opens the
 * link and clicks Continue, so repeated calls never pile up dead attempts.
 *
 * The student's own account details fill the form, but they still pick their
 * language and pass the mic/camera check on the start screen, exactly like any
 * other candidate.
 */

/**
 * PathSaathi's student payload. They POST a full student profile; we take only
 * what the interview needs and ignore the rest (zod strips unknown keys). The
 * few fields below are the only ones pinned — the mapping to our form lives
 * just after parsing.
 */
const bodySchema = z.object({
  // Their record id — REQUIRED, since it is what the result is keyed back to.
  student_uuid: z.string().trim().min(1).max(128),
  full_name: z.string().trim().max(120).nullish(),
  first_name: z.string().trim().max(80).nullish(),
  middle_name: z.string().trim().max(80).nullish(),
  last_name: z.string().trim().max(80).nullish(),
  email: z.string().trim().max(255).nullish(),
  phone: z.string().trim().max(20).nullish(),
  // Course sits nested under training_record, e.g. "Industrial Electrician".
  training_record: z
    .object({ course: z.string().trim().max(120).nullish() })
    .nullish(),
});

/** Constant-time bearer check, so the key cannot be recovered by timing. */
function authorised(request: Request, key: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = env.INTEGRATION_API_KEY;
  const interviewToken = env.INTEGRATION_INTERVIEW_TOKEN;
  if (!apiKey || !interviewToken) {
    return NextResponse.json(
      { error: "Student integration is not configured." },
      { status: 503 },
    );
  }
  if (!authorised(request, apiKey)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid student data.",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const d = parsed.data;
  const name =
    d.full_name?.trim() ||
    [d.first_name, d.middle_name, d.last_name]
      .filter((p) => p && p.trim())
      .join(" ")
      .trim();
  if (!name) {
    return NextResponse.json(
      { error: "A student name is required (full_name or name parts)." },
      { status: 422 },
    );
  }

  const blob = encodePrefill({
    name,
    email: d.email ?? undefined,
    phone: d.phone ?? undefined,
    course: d.training_record?.course ?? undefined,
    studentId: d.student_uuid,
  });
  const url = await absoluteUrl(`/i/${interviewToken}?p=${blob}`);

  return NextResponse.json({ url });
}
