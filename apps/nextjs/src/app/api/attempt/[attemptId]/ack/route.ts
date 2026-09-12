import { NextResponse } from "next/server";

import { resolveInterviewLanguage } from "~/config/languages";
import { getAttemptForCandidate } from "~/server/attempt/access";
import { generateSpeech } from "~/server/services/sarvam";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The interviewer's spoken "thank you", played the moment a candidate finishes
 * an answer while the next question is prepared.
 *
 * It is the same short line in the interview language for every answer, so it
 * is synthesised once per language and kept in memory — every later request,
 * for any candidate in that language, is served the cached clip rather than
 * paying for another Sarvam call.
 */
const clipByLanguage = new Map<string, { audio: Buffer; mimeType: string }>();

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const { attemptId: raw } = await ctx.params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const found = await getAttemptForCandidate(parsed.data);
  if (!found) {
    return NextResponse.json({ error: "Session expired." }, { status: 401 });
  }

  const language = found.attempt.language
    ? resolveInterviewLanguage(found.attempt.language)
    : resolveInterviewLanguage("english");

  try {
    let clip = clipByLanguage.get(language.code);
    if (!clip) {
      const speech = await generateSpeech(language.acknowledgement, {
        languageCode: language.code,
      });
      clip = { audio: speech.audio, mimeType: speech.mimeType };
      clipByLanguage.set(language.code, clip);
    }

    return new Response(new Uint8Array(clip.audio), {
      headers: {
        "Content-Type": clip.mimeType,
        // Not cacheable by URL: the clip depends on the attempt's
        // language, and the URL does not. Cached for a day, a candidate who
        // switched language kept hearing the old one for the rest of the
        // interview.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[attempt] acknowledgement audio failed", error);
    return NextResponse.json({ error: "No audio." }, { status: 500 });
  }
}
