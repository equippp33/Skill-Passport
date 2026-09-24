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
 * The partner's student payload.
 *
 * ADJUST THESE FIELD NAMES to match the JSON the partner actually sends — this
 * schema is the only place the shape is pinned.
 */
const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(255).nullish(),
  phone: z.string().trim().max(20).nullish(),
  course: z.string().trim().max(120).nullish(),
  // The partner's own student id — echoed back with the result so they can
  // match it to their record. Strongly recommended; results are otherwise only
  // matchable by email.
  studentId: z.string().trim().max(128).nullish(),
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

  const blob = encodePrefill({
    name: parsed.data.name,
    email: parsed.data.email ?? undefined,
    phone: parsed.data.phone ?? undefined,
    course: parsed.data.course ?? undefined,
    studentId: parsed.data.studentId ?? undefined,
  });
  const url = await absoluteUrl(`/i/${interviewToken}?p=${blob}`);

  return NextResponse.json({ url });
}
