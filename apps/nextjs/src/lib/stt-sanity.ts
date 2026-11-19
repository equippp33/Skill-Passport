/**
 * Spot Sarvam's speech-to-text silence-hallucinations.
 *
 * Handed near-silence, the speech model does not return nothing — it invents
 * stock "YouTube tutorial" narration and returns THAT as the transcript.
 * Observed, verbatim, across many different candidates who said nothing at all:
 *   "Okay Okay Okay, so this is the same type of problem that we were trying…"
 *   "Okay, so I'm going to try to connect this to the phone. Okay, so Okay, so"
 *   "Okay, so I'm going to try and do a little bit of a video today. Okay"
 *
 * Judged sentence by sentence, with only the tells found to be safe:
 *  - the invented phrases themselves (they never occur in a real answer);
 *  - a sentence of nothing but filler ("Okay, so"), or mostly filler with a
 *    filler word looping 3+ times in a row ("Okay okay okay so").
 *
 * Generic repetition is deliberately NOT a tell. Real speech repeats all the
 * time ("I will… I will… I will", "काय काय"). An earlier version also flagged
 * any word pair repeated 3+ times, or one word making up 25% of the answer;
 * run over the 15.6k stored answers that rejected 49% of them — mostly real,
 * scored answers — and good candidates were re-asked the same question 5–6
 * times. This version flags 31 of those answers, all of them invented text.
 *
 * Silence is mainly stopped at the source (the voice gate in
 * use-streaming-stt.ts sends Sarvam zeros instead of room noise); this is the
 * safety net for what still slips through.
 *
 * Shared by the browser (so junk never counts as "answered" and never advances
 * the interview) and the server (so junk is never stored as the answer).
 */

/**
 * Phrases the model invents out of silence. They never occur in a real
 * workplace-skills answer, so they are safe to reject on sight. Matched as
 * substrings of the lower-cased transcript.
 */
const FILLER_FRAGMENTS = [
  "little bit of a video",
  "connect this to the phone",
  "connect this to the system",
  "move my hand",
  "going to try to connect",
  "add a little bit of oil",
  "same type of problem that we were trying",
];

/** Words the model loops when it invents speech out of silence. */
const FILLER_WORDS = new Set(["okay", "ok", "so", "hmm", "um", "uh"]);

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Is this one sentence invented rather than said? */
function isInventedSentence(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (FILLER_FRAGMENTS.some((f) => lower.includes(f))) return true;

  const words = wordsOf(sentence);
  if (words.length === 0) return false;
  const filler = words.filter((w) => FILLER_WORDS.has(w)).length;

  // Nothing but filler, two words or more: "Okay, so", "Okay okay okay so".
  // A lone "Okay" is left alone — it can be a genuine one-word reply.
  if (filler === words.length && words.length >= 2) return true;

  // Mostly filler with a word looping 3+ times in a row. Both are required,
  // so "okay okay okay, my name is Rahul and I'm from Pune" is a real answer.
  if (filler / words.length < 0.5) return false;
  let run = 1;
  for (let i = 1; i < words.length; i += 1) {
    run =
      words[i] === words[i - 1] && FILLER_WORDS.has(words[i]!) ? run + 1 : 1;
    if (run >= 3) return true;
  }
  return false;
}

/**
 * The transcript with invented sentences removed.
 *
 * Per SENTENCE, not all-or-nothing: the model often tacks its invention onto
 * the end of a real answer while the candidate sits quietly afterwards ("…I'll
 * seek help from resources in the office. Okay, so I'm going to try and do a
 * little bit of a video today."). Rejecting the whole transcript threw that
 * real answer away and re-asked the question; this keeps it and drops the tail.
 * Returns "" when nothing real was said.
 */
export function stripSttHallucinations(text: string): string {
  const sentences = text.match(/[^.?!।]+[.?!।]*/g) ?? [];
  return sentences
    .filter((s) => !isInventedSentence(s))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the transcript has words but none of them were really said. */
export function looksLikeSttHallucination(text: string): boolean {
  return text.trim() !== "" && stripSttHallucinations(text) === "";
}
