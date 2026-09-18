/**
 * Recognising what a candidate is asking for instead of answering.
 *
 * Three different asks that used to be one. "Say that again" wants the same
 * clip replayed; "say it slower" wants that plus a permanent change of pace;
 * "I didn't understand" wants a different, simpler wording. They were a single
 * list back when all three did the same thing — replay the question — and
 * merging them meant a candidate who did not follow the words got them again
 * at the same speed in the same phrasing, which helps nobody.
 *
 * Deliberately a phrase list rather than a model call. It runs on every
 * answer, so a round-trip here would tax every turn to catch a rare one, and
 * an interview that has to wait for a model before it can repeat itself is not
 * responsive. Being a little conservative is the right failure mode: a missed
 * request costs one more ask, while a false positive throws away a real
 * answer.
 */

/**
 * Only a short utterance is considered.
 *
 * "Could you repeat that?" is the whole reply when someone means it. Once an
 * answer is a sentence or two long, the word "repeat" inside it is far more
 * likely to be part of the answer — "I had to repeat the order back to the
 * customer" is a good reliability answer, not a request.
 */
const MAX_WORDS = 8;

export type UtteranceIntent = "repeat" | "slower" | "not_understood";

/**
 * "Say it more slowly."
 *
 * Checked FIRST, and that order is load-bearing: "फिर से धीरे बोलिए" (say it
 * again, slowly) contains the repeat needle "फिर से", so matching repeat first
 * would swallow every slow request that also says "again" — which is most of
 * how people actually phrase it.
 */
const SLOWER: string[] = [
  // English
  "slow",
  "slowly",
  "slower",
  "say it slowly",
  "speak slowly",
  "speak slower",
  "little slow",
  "bit slow",
  "too fast",
  "very fast",
  "speaking fast",

  // Hindi / Marathi, romanised
  "dhire",
  "dheere",
  "dhire bolo",
  "dheere bolo",
  "dhire boliye",
  "dheere boliye",
  "thoda dhire",
  "thoda dheere",
  "aaram se",
  "aste",
  "hallu",
  "savkash",
  "bahut tez",
  "bohot tez",

  // Devanagari
  "धीरे",
  "धीरे बोलो",
  "धीरे बोलिए",
  "थोड़ा धीरे",
  "आराम से",
  "हळू",
  "सावकाश",
  "खूप वेगात",
  "बहुत तेज",

  // Other supported scripts
  "மெதுவாக",
  "நிதானமா",
  "నెమ్మదిగా",
  "మెల్లగా",
  "ನಿಧಾನವಾಗಿ",
  "ಮೆಲ್ಲಗೆ",
  "ধীরে",
  "আস্তে",
  "ધીમે",
  "ધીરે",
  "പതുക്കെ",
  "സാവധാനം",
  "ਹੌਲੀ",
  "ਹੌਲੀ ਬੋਲੋ",
  "ଧୀରେ",
];

/**
 * "I didn't follow what that meant."
 *
 * Distinct from not having *heard* it: replaying the same sentence at the same
 * speed answers the second and not the first. These route to the prepared
 * simpler wording instead.
 */
const NOT_UNDERSTOOD: string[] = [
  // English
  "i did not understand",
  "i didnt understand",
  "didnt understand",
  "dont understand",
  "i dont understand",
  "not understand",
  "understand the question",
  "what do you mean",
  "meaning",
  "what does that mean",
  "confusing",
  "did not get it",
  "didnt get it",

  // Hindi / Marathi, romanised
  "samajh nahi aaya",
  "samajh nahin aaya",
  "samjha nahi",
  "nahi samjha",
  "matlab kya",
  "kya matlab",
  "samajle nahi",
  "kalale nahi",

  // Devanagari
  "समझ नहीं आया",
  "समझा नहीं",
  "मतलब क्या",
  "क्या मतलब",
  "समजले नाही",
  "कळले नाही",

  // Other supported scripts
  "புரியவில்லை",
  "அர்த்தம்",
  "అర్థం కాలేదు",
  "అర్థం",
  "ಅರ್ಥವಾಗಲಿಲ್ಲ",
  "ಅರ್ಥ",
  "বুঝিনি",
  "মানে কি",
  "સમજાયું નથી",
  "મતલબ",
  "മനസ്സിലായില്ല",
  "അർത്ഥം",
  "ਸਮਝ ਨਹੀਂ ਆਇਆ",
  "ਮਤਲਬ",
  "ବୁଝିଲି ନାହିଁ",
];

/**
 * "Say that again."
 *
 * Checked last of the three, so a phrase that is also a slow or
 * didn't-understand request lands on the more specific intent.
 */
const REPEAT: string[] = [
  // English
  "repeat",
  "repeat that",
  "repeat it",
  "repeat again",
  "say again",
  "say that again",
  "come again",
  "come again please",
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

function matches(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    const needle = normalise(phrase);
    return text === needle || text.includes(needle);
  });
}

/**
 * What the candidate is asking for, or null if this is an answer.
 *
 * Length is checked first: it is what stops "I repeat the checklist every
 * morning" from being read as a request.
 *
 * Order within the checks is deliberate — most specific first. See the note
 * on `SLOWER`.
 */
export function phraseIntent(transcript: string): UtteranceIntent | null {
  const text = normalise(transcript);
  if (!text) return null;

  const words = text.split(" ");
  if (words.length > MAX_WORDS) return null;

  if (matches(text, SLOWER)) return "slower";
  if (matches(text, NOT_UNDERSTOOD)) return "not_understood";
  if (matches(text, REPEAT)) return "repeat";
  return null;
}

/**
 * Whether this transcript is any kind of request rather than an answer.
 *
 * Kept as the coarse test for callers that only need to know "do not score
 * this" — the diagnostic log, and anything that treats all three the same.
 */
export function isRepeatRequest(transcript: string): boolean {
  return phraseIntent(transcript) !== null;
}
