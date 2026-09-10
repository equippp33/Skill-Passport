/**
 * Recognising "say that again".
 *
 * A candidate who did not catch the question asks for it again rather than
 * answering, and scoring that as their answer to a workplace-skills question
 * is both wrong and demoralising. This spots the ask so the question can be
 * repeated instead.
 *
 * Deliberately a phrase list rather than a model call. It runs on every
 * answer, so a second round-trip to OpenAI would tax every turn to catch a
 * rare one; and the phrases people actually use here are a short, closed
 * set in any language. Being a little conservative is the right failure
 * mode — missing one costs a repeat the candidate can ask for again, while
 * a false positive would throw away a real answer.
 */

/**
 * Only a short utterance is considered.
 *
 * "Could you repeat that?" is the whole reply when someone means it. Once
 * an answer is a sentence or two long, the word "repeat" inside it is far
 * more likely to be part of the answer — "I had to repeat the order back to
 * the customer" is a good reliability answer, not a request.
 */
const MAX_WORDS = 8;

/**
 * Matched against the transcript with separators and case stripped.
 *
 * Latin entries cover both English and how people romanise their own
 * language; native-script entries cover the rest. Hindi and Marathi share
 * much of this, which is fine — a list, not a classifier.
 */
const PHRASES: string[] = [
  // English
  "repeat",
  "repeat that",
  "repeat it",
  "repeat again",
  "say again",
  "say that again",
  "come again",
  "pardon",
  "sorry what",
  "what was that",
  "i did not hear",
  "i didnt hear",
  "i cant hear",
  "i cannot hear",
  "could not hear",
  "one more time",
  "once again",
  "again please",
  "please repeat",
  "ask again",

  // Hindi / Marathi, romanised
  "phir se",
  "fir se",
  "phir se bolo",
  "fir se boliye",
  "dobara",
  "dubara",
  "dobara bolo",
  "dobara boliye",
  "vapas bolo",
  "wapas bolo",
  "wapis bolo",
  "punha",
  "punha sanga",
  "parat sanga",
  "parat bola",
  "samajh nahi aaya",
  "suna nahi",
  "sunai nahi diya",

  // Devanagari
  "फिर से",
  "फिर से बोलो",
  "फिर से बोलिए",
  "दोबारा",
  "दोबारा बोलो",
  "दोबारा बोलिए",
  "वापस बोलो",
  "समझ नहीं आया",
  "सुनाई नहीं दिया",
  "पुन्हा",
  "पुन्हा सांगा",
  "परत सांगा",
  "परत बोला",
  "ऐकू आले नाही",

  // Other supported scripts, the short forms only
  "மீண்டும்",
  "மீண்டும் சொல்லுங்கள்",
  "మళ్లీ",
  "మళ్లీ చెప్పండి",
  "ಮತ್ತೆ",
  "ಮತ್ತೆ ಹೇಳಿ",
  "ফির",
  "আবার বলুন",
  "ફરીથી",
  "ફરીથી કહો",
  "വീണ്ടും",
  "വീണ്ടും പറയൂ",
  "ਦੁਬਾਰਾ",
  "ਦੁਬਾਰਾ ਦੱਸੋ",
  "ପୁନର୍ବାର",
];

/** Lower-cased, punctuation removed, whitespace collapsed. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’()\-—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether this transcript is asking for the question again.
 *
 * Length is checked first: it is what stops "I repeat the checklist every
 * morning" from being read as a request.
 */
export function isRepeatRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text) return false;

  const words = text.split(" ");
  if (words.length > MAX_WORDS) return false;

  return PHRASES.some((phrase) => {
    const needle = normalise(phrase);
    return text === needle || text.includes(needle);
  });
}
