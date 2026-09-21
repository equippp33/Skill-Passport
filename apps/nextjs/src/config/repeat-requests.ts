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
  // Didn't catch the meaning (distinct from didn't hear).
  "i did not understand",
  "i didnt understand",
  "didnt understand",
  "dont understand",
  "i dont understand",
  "not understand",
  "understand the question",
  "what do you mean",
  "come again please",

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

/**
 * "Move on / skip this one" — a command, not an answer.
 *
 * Same guardrails as the repeat check: only a short utterance counts, so
 * "next, I told the customer to wait" (a real answer that starts with "next")
 * is not mistaken for a skip.
 */
const SKIP_PHRASES: string[] = [
  // English
  "skip",
  "skip this",
  "skip it",
  "skip question",
  "next",
  "next question",
  "next one",
  "move on",
  "leave it",
  // Hindi / Marathi, romanised
  "agla sawaal",
  "agla question",
  "aage badho",
  "aage badhe",
  "aage chalo",
  "chhod do",
  "chhodo",
  "isko chhodo",
  "pudhcha prashna",
  "pudhe chala",
  // Devanagari
  "अगला सवाल",
  "अगला प्रश्न",
  "आगे बढ़ो",
  "आगे चलो",
  "छोड़ दो",
  "पुढचा प्रश्न",
  "पुढे चला",
  // Other scripts, short forms
  "తదుపరి ప్రశ్న",
  "తర్వాత ప్రశ్న",
  "వదిలేయండి",
  "அடுத்த கேள்வி",
  " முந்தைய",
];

/**
 * Unambiguous "I want to skip / I can't answer" phrases.
 *
 * Unlike the short list above, these are checked WITHOUT the word limit: they
 * are specific enough that they mean skip even buried in a longer sentence —
 * "I don't have an answer for it, can we skip this question?" is a skip, not an
 * answer, and the 8-word guard was throwing it into the doubt loop instead.
 */
const STRONG_SKIP_PHRASES: string[] = [
  "skip this question",
  "skip the question",
  "skip this one",
  "skip this",
  "can we skip",
  "can i skip",
  "i want to skip",
  "lets skip",
  "i dont want to answer",
  "dont want to answer",
  "i cant answer this",
  "i cannot answer this",
  "i have no answer",
  "i dont have an answer",
  "i dont have any answer",
];

export function isSkipRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text) return false;

  // Strong phrases mean skip at any length.
  if (STRONG_SKIP_PHRASES.some((p) => text.includes(normalise(p)))) return true;

  const words = text.split(" ");
  if (words.length > MAX_WORDS) return false;

  return SKIP_PHRASES.some((phrase) => {
    const needle = normalise(phrase);
    return text === needle || text.includes(needle);
  });
}

/**
 * "Say it slower" — a command. The current question is re-voiced at a slower
 * pace. Same short-utterance guard as the others.
 */
const SLOWER_PHRASES: string[] = [
  // English
  "slowly",
  "slower",
  "slow down",
  "speak slowly",
  "say it slowly",
  "too fast",
  "bit slow",
  // Hindi / Marathi, romanised
  "dheere",
  "dheere",
  "dheere boliye",
  "dheere bolo",
  "aaram se boliye",
  "halu bola",
  "halu bola na",
  "savkash",
  "savkash bola",
  // Devanagari
  "धीरे",
  "धीरे बोलिए",
  "धीरे बोलो",
  "हळू बोला",
  "सावकाश",
  "सावकाश बोला",
  // Other scripts
  "నెమ్మదిగా",
  "నెమ్మదిగా చెప్పండి",
  "మెల్లగా",
  "மெதுவாக",
  "மெதுவாக சொல்லுங்கள்",
];

export function isSlowerRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text) return false;

  const words = text.split(" ");
  if (words.length > MAX_WORDS) return false;

  return SLOWER_PHRASES.some((phrase) => {
    const needle = normalise(phrase);
    return text === needle || text.includes(needle);
  });
}
