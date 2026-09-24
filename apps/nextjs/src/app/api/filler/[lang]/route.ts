import { NextResponse } from "next/server";

import { env } from "~/env";
import {
  INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGE_KEYS,
} from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import { FILLERS_BY_KEY } from "~/config/greeting";
import { generateSpeech } from "~/server/services/sarvam";
import { getAudioObject, putAudioObject } from "~/server/interview/storage";

export const dynamic = "force-dynamic";

/**
 * A short spoken filler, played the instant the candidate stops speaking.
 *
 * The point is the ILLUSION of a continuous conversation: instead of dead air
 * while STT -> GPT -> TTS runs (~5s), the candidate immediately hears the
 * interviewer acknowledge them, so the turn feels like a reply, not a lag.
 *
 * The line is fixed per language (the acknowledgement), so it is generated ONCE
 * and cached in R2 forever, shared across every attempt in that language — no
 * per-attempt work, no database row. The first request in a given language
 * pays the ~1.5s TTS; every request after is a straight object read. The client
 * pre-fetches it when the interview loads, so even the first turn is instant.
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
  const variants = FILLERS_BY_KEY[lang as InterviewLanguageKey];

  // Which filler variant — clamped into range so a bad ?v= can't 404.
  const requested = Number(new URL(request.url).searchParams.get("v") ?? "0");
  const v = Number.isFinite(requested)
    ? Math.min(Math.max(0, Math.trunc(requested)), variants.length - 1)
    : 0;

  const key = `${env.CLOUDFLARE_R2_PREFIX}/fillers/${lang}-${v}-${env.SARVAM_TTS_SPEAKER}.mp3`;

  let bytes = await getAudioObject(key);
  if (!bytes) {
    const speech = await generateSpeech(variants[v]!, {
      languageCode: language.code,
    });
    await putAudioObject({ key, body: speech.audio, mimeType: "audio/mpeg" });
    bytes = speech.audio;
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/mpeg",
      // Fixed per language and safe to cache hard: it never changes.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
