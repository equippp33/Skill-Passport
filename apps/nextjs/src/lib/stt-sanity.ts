/**
 * Spot Sarvam's speech-to-text silence-hallucinations.
 *
 * Handed near-silence, the batch endpoint (and occasionally realtime) does not
 * return nothing — it invents looping canned filler and returns THAT as the
 * transcript. Observed, verbatim, across many different candidates who said
 * nothing at all:
 *   "Okay Okay Okay, so this is the same type of problem that we were trying…"
 *   "Okay, so I'm going to try to connect this to the phone. Okay, so Okay, so"
 *   "Okay, so I'm going to try and do a little bit of a video today. Okay"
 *
 * Real speech does not loop a word three times in a row, nor let one or two
 * tokens dominate a whole utterance. Those are the tells, and they are cheap to
 * check. Deliberately conservative: a miss just lets one junk answer through
 * (caught again next turn), a false positive would throw away a real answer —
 * so the thresholds sit well clear of anything a genuine reply produces.
 *
 * Shared by the browser (so junk never counts as "answered" and never advances
 * the interview) and the server (so junk is never stored as the answer).
 */
/**
 * Distinctive filler the model loops that the repetition checks can miss when
 * it only repeats a sentence twice. These are "making a YouTube video" style
 * phrases that simply never occur in a real workplace-skills answer, so they are
 * safe to reject on sight. Matched as substrings of the lower-cased transcript.
 */
const FILLER_FRAGMENTS = [
  "little bit of a video",
  "connect this to the phone",
  "move my hand",
  "going to try to connect",
];

export function looksLikeSttHallucination(text: string): boolean {
  const lower = text.toLowerCase();
  if (FILLER_FRAGMENTS.some((f) => lower.includes(f))) return true;

  const words = lower
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Too short to judge — and a genuine one-word answer must never be rejected.
  if (words.length < 6) return false;

  // A word repeated 3+ times in a row ("okay okay okay") — a pure STT loop.
  let run = 1;
  for (let i = 1; i < words.length; i += 1) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 3) return true;
  }

  // One token carrying a quarter or more of the whole utterance, or any single
  // bigram ("okay so") repeating three times or more: looped filler, not an
  // answer. A real reply of this length spreads across far more vocabulary.
  const unigrams = new Map<string, number>();
  const bigrams = new Map<string, number>();
  for (let i = 0; i < words.length; i += 1) {
    unigrams.set(words[i]!, (unigrams.get(words[i]!) ?? 0) + 1);
    if (i > 0) {
      const bg = `${words[i - 1]} ${words[i]}`;
      bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
    }
  }
  const maxUnigram = Math.max(...unigrams.values());
  const maxBigram = Math.max(0, ...bigrams.values());
  if (maxUnigram / words.length >= 0.25) return true;
  if (maxBigram >= 3) return true;

  return false;
}
