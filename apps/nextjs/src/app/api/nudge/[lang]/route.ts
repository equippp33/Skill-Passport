import { NextResponse } from "next/server";

import { env } from "~/env";
import {
  INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGE_KEYS,
} from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import { TAKE_YOUR_TIME_BY_KEY } from "~/config/greeting";
import { generateSpeech } from "~/server/services/sarvam";
import { getAudioObject, putAudioObject } from "~/server/interview/storage";

export const dynamic = "force-dynamic";

/**
 * The "take your time" nudge, played when a candidate goes quiet.
 *
 * Fixed per language, so it is generated once and cached in R2 forever, shared
 * across every attempt — same pattern as the fillers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lang: string }> },
): Promise<NextResponse> {
  const { lang } = await params;

  if (!(INTERVIEW_LANGUAGE_KEYS as readonly string[]).includes(lang)) {
    return new NextResponse("Unknown language", { status: 404 });
  }
  const language = INTERVIEW_LANGUAGES[lang as InterviewLanguageKey];
  const key = `${env.CLOUDFLARE_R2_PREFIX}/nudges/${lang}.mp3`;

  let bytes = await getAudioObject(key);
  if (!bytes) {
    const speech = await generateSpeech(
      TAKE_YOUR_TIME_BY_KEY[lang as InterviewLanguageKey],
      { languageCode: language.code },
    );
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
