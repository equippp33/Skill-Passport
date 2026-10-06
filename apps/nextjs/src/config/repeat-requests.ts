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

/**
 * The cap when the interviewer has just asked something short.
 *
 * After "would you like to add anything?" there is no long answer to protect:
 * anything said is a reply to that, so a request can be as polite and rambling
 * as people actually are — "sorry sir please say the question again I did not
 * understand" is eleven words and was being scored as an answer, which ended
 * the question and moved the interview on.
 */
const PROMPT_REPLY_MAX_WORDS = 16;

export type UtteranceIntent =
  "repeat" | "slower" | "not_understood" | "off_topic";

/**
 * Talking to the interviewer instead of answering it.
 *
 * Two kinds, handled the same way. Chit-chat — "what is your name?", "are you
 * a robot?" — and fishing for the answer — "what should I say?", "just tell
 * me". Neither is an attempt at the question, so neither should be marked as
 * one, and both want the same reply: warmly, back to the question.
 *
 * Checked LAST, after the three request kinds, and that order is load-bearing.
 * "What do you mean?" is a genuine doubt and lives in NOT_UNDERSTOOD; "what
 * should I say?" is a request for the answer and lives here. Matching this
 * list first would swallow the doubt.
 *
 * Deliberately narrow. A phrase that also appears inside real answers costs a
 * candidate their question, so this holds only openings that are never an
 * answer to "tell me about a time when...".
 */
const OFF_TOPIC: string[] = [
  // Fishing for the answer.
  "what should i say",
  "what do i say",
  "what to say",
  "tell me the answer",
  "just tell me",
  "you tell me",
  "give me the answer",
  "what is the right answer",
  "whats the right answer",
  "what is the correct answer",
  "kya bolu",
  "kya bolun",
  "kya kahu",
  "aap bataiye",
  "aap batao",
  "tum batao",
  "answer bata do",
  "क्या बोलूं",
  "क्या कहूं",
  "आप बताइए",
  "आप बताओ",
  "तुम बताओ",
  "काय सांगू",
  "तुम्ही सांगा",
  // Chit-chat with the interviewer.
  "what is your name",
  "whats your name",
  "who are you",
  "are you a robot",
  "are you a human",
  "are you human",
  "are you real",
  "is this a robot",
  "is this ai",
  "are you ai",
  "where are you from",
  "how old are you",
  "aapka naam",
  "tumhara naam",
  "aap kaun ho",
  "tum kaun ho",
  "kya tum robot ho",
  "आपका नाम",
  "तुम्हारा नाम",
  "आप कौन ह",
  "तुम कौन ह",
  "तुम्हाला नाव",
  "तुमचं नाव",
  "আপনার নাম",
  "তুমি কে",
  "તમારું નામ",
  "ನಿಮ್ಮ ಹೆಸರು",
  "നിങ്ങളുടെ പേര",
  "ଆପଣଙ୍କ ନାମ",
  "ਤੁਹਾਡਾ ਨਾਮ",
  "உங்க பேர",
  "மீ பேரு",
  "మీ పేరు",
];

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

/**
 * Whole-word matching, for needles too short to be safe as substrings.
 *
 * "no" appears inside "I do not know", "not sure sir" and "no idea" once you
 * match on substrings — and reading any of those as a refusal threw the
 * candidate's actual words away. Padding both sides with spaces turns the
 * check into a token match without needing word boundaries, which regex
 * cannot give us across eleven scripts.
 */
function matchesWord(text: string, phrases: string[]): boolean {
  const padded = ` ${text} `;
  return phrases.some((phrase) => {
    const needle = normalise(phrase);
    return text === needle || padded.includes(` ${needle} `);
  });
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
export function phraseIntent(
  transcript: string,
  /**
   * True when this was said straight after a short prompt from the
   * interviewer rather than as an answer to a question. Relaxes the length
   * gate — see `PROMPT_REPLY_MAX_WORDS`.
   */
  replyingToPrompt = false,
): UtteranceIntent | null {
  const text = normalise(transcript);
  if (!text) return null;

  const words = text.split(" ");
  const cap = replyingToPrompt ? PROMPT_REPLY_MAX_WORDS : MAX_WORDS;
  if (words.length > cap) return null;

  if (matches(text, SLOWER)) return "slower";
  if (matches(text, NOT_UNDERSTOOD)) return "not_understood";
  if (matches(text, REPEAT)) return "repeat";
  if (matches(text, OFF_TOPIC)) return "off_topic";
  return null;
}

/**
 * Whether this transcript is any kind of request rather than an answer.
 *
 * Kept as the coarse test for callers that only need to know "do not score
 * this" — the diagnostic log, and anything that treats all three the same.
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
