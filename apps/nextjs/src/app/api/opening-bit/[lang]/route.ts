import { NextResponse } from "next/server";

import { env } from "~/env";
import {
  INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGE_KEYS,
} from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import { OPENING_BIT_PROMPTS_BY_KEY } from "~/config/greeting";
import { generateSpeech } from "~/server/services/sarvam";
import { getAudioObject, putAudioObject } from "~/server/interview/storage";

export const dynamic = "force-dynamic";

/**
 * The 2nd/3rd bits of the opening turn ("what are your hobbies?", "where do you
 * live?"), played one after another while the mic keeps recording. Fixed per
 * language + voice, generated once and cached in R2, shared across every attempt
 * — same pattern as the check-in and the fillers. `?b=0` is hobbies, `?b=1` is
 * location; keyed by speaker so a voice change gets its own clip.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ lang: string }> },
): Promise<NextResponse> {
  const { lang } = await params;

  if (!(INTERVIEW_LANGUAGE_KEYS as readonly string[]).includes(lang)) {
    return new NextResponse("Unknown language", { status: 404 });
  }
  const language = INTERVIEW_LANGUAGES[lang as InterviewLanguageKey];
  const prompts = OPENING_BIT_PROMPTS_BY_KEY[lang as InterviewLanguageKey];

  // Which bit — clamped into range so a bad ?b= can't 404.
  const requested = Number(new URL(request.url).searchParams.get("b") ?? "0");
  const b = Number.isFinite(requested)
    ? Math.min(Math.max(0, Math.trunc(requested)), prompts.length - 1)
    : 0;

  const key = `${env.CLOUDFLARE_R2_PREFIX}/openings/${lang}-${b}-${env.SARVAM_TTS_SPEAKER}.mp3`;

  let bytes = await getAudioObject(key);
  if (!bytes) {
    const speech = await generateSpeech(prompts[b]!, {
      languageCode: language.code,
    });
    await putAudioObject({ key, body: speech.audio, mimeType: "audio/mpeg" });
    bytes = speech.audio;
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
