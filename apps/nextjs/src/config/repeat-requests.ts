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
  "samajh nahi aya",
  "samajh nahi",
  "samjha nahi",
  "nahi samjha",
  "suna nahi",
  "sunai nahi diya",

  // Devanagari
  "फिर से",
  "फिर से बोलो",
  "फिर से बोलिए",
  "दोबारा",
  "दोबारा बोलो",
  "दोबारा बोलिए",
  // The everyday spelling, with ु rather than ो — and the one Sarvam
  // writes for "dubara boliye". Without it, the most common way of asking for
  // a repeat in Hindi matched nothing at all.
  "दुबारा",
  "दुबारा बोलो",
  "दुबारा बोलिए",
  "दुबारा बताइए",
  "वापस बोलो",
  "समझ नहीं आया",
  "समझ नहीं",
  "समझा नहीं",
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
  "ଆଉ ଥରେ",
  "ପୁଣି ଥରେ",
  "ପୁଣି କୁହନ୍ତୁ",
  "మళ్ళీ",
  "మళ్ళీ చెప్పండి",
  "ಮತ್ತೊಮ್ಮೆ",
  "திரும்ப சொல்லுங்கள்",
  "திரும்ப சொல்லுங்க",
  "আবার",
  "আরেকবার বলুন",
  "ફરી",
  "ફરી કહો",
  "ਫਿਰ ਤੋਂ",
  "ਦੁਬਾਰਾ ਕਹੋ",
  "ഒന്നുകൂടി പറയൂ",
  "ഒന്നൂടെ പറയൂ",
  "ಇನ್ನೊಮ್ಮೆ",
  "আরেকবার",
  "ఇంకోసారి",
  "இன்னொரு முறை",
  "ഒന്നുകൂടി",
  "ਇੱਕ ਵਾਰ ਫਿਰ",
  "ફરી એકવાર",
  // English "repeat" as Sarvam spells it in each script: candidates say the
  // English word inside a Hindi / Tamil / … interview, and it comes back in
  // that script, matching nothing above.
  "रिपीट करो",
  "रिपीट कीजिए",
  "रिपीट करिए",
  "रिपीट कर दो",
  "रिपीट प्लीज",
  "प्लीज रिपीट",
  "ரிப்பீட்",
  "రిపీట్",
  "ರಿಪೀಟ್",
  "রিপিট",
  "રિપીટ",
  "റിപ്പീറ്റ്",
  "ਰਿਪੀਟ",
  "ରିପିଟ",
];

/** Lower-cased, punctuation removed, whitespace collapsed. */
function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      // Apostrophes are dropped, not spaced: "don't" must become "dont" to
      // match the phrase lists, not "don t".
      .replace(/['‘’]/g, "")
      .replace(/[.,!?;:"“”()\-—।]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
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

  // A lone "रिपीट" (English "repeat" in Devanagari). Inside a sentence it only
  // counts in a request form ("रिपीट करो") — "मैं उस से रिपीट करने के लिए
  // कहूँगा" (I would ask them to repeat) is a real answer.
  if (text === "रिपीट" || text === "रिपीट प्लीज") return true;

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
  "விட்டுவிடுங்கள்",
  "ಮುಂದಿನ ಪ್ರಶ್ನೆ",
  "ಬಿಟ್ಟುಬಿಡಿ",
  "পরের প্রশ্ন",
  "বাদ দিন",
  "આગળનો પ્રશ્ન",
  "પછીનો પ્રશ્ન",
  "છોડી દો",
  "അടുത്ത ചോദ്യം",
  "ഒഴിവാക്കൂ",
  "ਅਗਲਾ ਸਵਾਲ",
  "ਛੱਡ ਦਿਓ",
  "ପରବର୍ତ୍ତୀ ପ୍ରଶ୍ନ",
  "ଛାଡ଼ି ଦିଅନ୍ତୁ",
  // English "next" / "skip" as Sarvam spells them in each script — "नेक्स्ट
  // क्वेश्चन प्लीज" turns up in real Hindi and Marathi interviews and used to
  // match nothing.
  "नेक्स्ट क्वेश्चन",
  "नेक्स्ट प्रश्न",
  "नेक्स्ट वन",
  "स्किप",
  "ஸ்கிப்",
  "స్కిప్",
  "ಸ್ಕಿಪ್",
  "স্কিপ",
  "સ્કિપ",
  "സ്കിപ്പ്",
  "ਸਕਿੱਪ",
  "ସ୍କିପ",
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
  "dont want to say",
  "dont want to tell",
  "jawab nahi dena",
  "जवाब नहीं देना",
  "नहीं बताना",
  "उत्तर द्यायचं नाही",
  "सांगायचं नाही",
];

/**
 * "I don't know" — giving up on the question, as opposed to asking about it.
 *
 * Server-side only: it decides whether a doubt counts towards skipping. Kept
 * out of the skip lists on purpose, because those also advance the browser
 * immediately, and "I don't know exactly, but I would…" is the start of an
 * answer. Short utterances only, for the same reason.
 */
const GIVE_UP_PHRASES: string[] = [
  "i dont know",
  "dont know",
  "no idea",
  "i have no idea",
  "pata nahi",
  "mujhe nahi pata",
  "maloom nahi",
  "mahit nahi",
  "nahi mahit",
  "pata nhi",
  "nahi pata",
  "nahi maloom",
  "mahit nai",
  "mahiti nahi",
  // Hindi
  "पता नहीं",
  "नहीं पता",
  "मालूम नहीं",
  "नहीं मालूम",
  "नहीं जानता",
  "नहीं जानती",
  "जवाब नहीं पता",
  // Marathi — both spellings: Sarvam writes "माहीत" (long ई) as often as
  // "माहित", and "माहिती" in "मला नाही माहिती".
  "माहित नाही",
  "माहीत नाही",
  "नाही माहित",
  "नाही माहीत",
  "नाही माहिती",
  "माहिती नाही",
  "ठाऊक नाही",
  // English "I don't know" as Sarvam spells it in Devanagari.
  "डोंट नो",
  "डोन्ट नो",
  // Other supported languages
  "தெரியாது",
  "తెలియదు",
  "ಗೊತ್ತಿಲ್ಲ",
  "জানি না",
  "ખબર નથી",
  "അറിയില്ല",
  "ਪਤਾ ਨਹੀਂ",
  "ਨਹੀਂ ਪਤਾ",
  "ଜାଣି ନାହିଁ",
  "ଜାଣେ ନାହିଁ",
];

export function isGiveUpRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text || text.split(" ").length > MAX_WORDS) return false;
  return GIVE_UP_PHRASES.some((p) => text.includes(normalise(p)));
}

/**
 * "Explain the question" — the candidate wants the MEANING, not a replay.
 *
 * "I didn't understand" / "samajh nahi aaya" also sit in the repeat list
 * (the opening still just replays on them), but on a real question the
 * interviewer should explain rather than say the same words again. Callers
 * check this BEFORE `isRepeatRequest`. The explanation is spoken by the
 * interviewer; it never answers the question for them.
 */
const EXPLAIN_PHRASES: string[] = [
  // English. Phrased as requests: a bare "explain" also turns up inside short
  // real answers ("I would explain it to the customer").
  "can you explain",
  "could you explain",
  "please explain",
  "explain me",
  "explain the question",
  "explain this question",
  "explain question",
  "explain again",
  "explain once",
  "explain properly",
  "explain in",
  "what does it mean",
  "what does this mean",
  "what is the meaning",
  "meaning of this",
  "meaning of the question",
  "what do you mean",
  "i did not understand",
  "i didnt understand",
  "didnt understand",
  "dont understand",
  "i dont understand",
  "not understand",
  "not getting the question",
  "not getting you",
  "didnt get the question",
  "didnt get you",
  "did not get the question",
  "understand the question",
  // Hindi / Marathi, romanised. Not a bare "matlab": it is everyday filler
  // ("matlab, main pehle…").
  "samjhao",
  "samjhaiye",
  "samjha do",
  "samjha dijiye",
  "samajh nahi aaya",
  "samajh nahi aya",
  "samajh nahi",
  "samjha nahi",
  "nahi samjha",
  "matlab kya",
  "kya matlab",
  "iska matlab",
  "explain karo",
  "explain kariye",
  "explain kijiye",
  "explain kara",
  "samjun sanga",
  "samjavun sanga",
  "samajla nahi",
  "samajle nahi",
  "kalala nahi",
  // Devanagari
  "समझाइए",
  "समझाओ",
  "समझा दो",
  "समझा दीजिए",
  "समझ नहीं आया",
  "समझ नहीं",
  "समझा नहीं",
  "मतलब क्या",
  "क्या मतलब",
  "इसका मतलब",
  "अर्थ क्या",
  "अर्थ काय",
  "याचा अर्थ",
  "समजावून सांगा",
  "समजून सांगा",
  "समजलं नाही",
  "समजले नाही",
  "कळलं नाही",
  "कळले नाही",
  // Other supported scripts
  "விளக்கவும்",
  "புரியவில்லை",
  "వివరించండి",
  "అర్థం కాలేదు",
  "ವಿವರಿಸಿ",
  "ಅರ್ಥವಾಗಲಿಲ್ಲ",
  "বুঝিয়ে বলুন",
  "বুঝতে পারিনি",
  "સમજાવો",
  "સમજાયું નહીં",
  "വിശദീകരിക്കൂ",
  "മനസ്സിലായില്ല",
  "ਸਮਝਾਓ",
  "ਸਮਝ ਨਹੀਂ ਆਇਆ",
  "ବୁଝାନ୍ତୁ",
  "ବୁଝି ପାରିଲି ନାହିଁ",
  "ବୁଝିଲି ନାହିଁ",
  "புரியல",
  "புரியலை",
  "விளக்கமா சொல்லுங்க",
  "అర్ధం కాలేదు",
  "ಅರ್ಥ ಆಗಲಿಲ್ಲ",
  "ಅರ್ಥ ಆಗಿಲ್ಲ",
  "বুঝিনি",
  "বুঝলাম না",
  "સમજ ન પડી",
  "સમજાયું નથી",
  "മനസിലായില്ല",
  "ਸਮਝ ਨਹੀਂ ਆਈ",
  // English "explain" as Sarvam spells it in Devanagari.
  "एक्सप्लेन करो",
  "एक्सप्लेन कीजिए",
  "एक्सप्लेन करिए",
  "एक्सप्लेन करा",
];

/** A request is a sentence, not an answer: anything longer is answering. */
const EXPLAIN_MAX_WORDS = 8;

/**
 * Whether the candidate is asking for the question to be explained, in any
 * supported language. The explanation is always given in the interview
 * language.
 */
export function isExplainRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text || text.split(" ").length > EXPLAIN_MAX_WORDS) return false;
  // Whole words only: "समजून सांगा" (please explain) must not match inside
  // "समजून सांगायचं" (to explain to someone), which is a real answer.
  const padded = ` ${text} `;
  return EXPLAIN_PHRASES.some((p) => padded.includes(` ${normalise(p)} `));
}

/**
 * A plain "no" — the candidate declining a FOLLOW-UP.
 *
 * Only the follow-up path uses this: a follow-up digs into something the
 * candidate already said and may simply be beyond them, so "No" / "Nahi" there
 * means "I have nothing to add", and they must not be pushed. On a main
 * question a bare "no" is left to the normal doubt handling.
 *
 * The WHOLE reply must be negatives plus politeness ("No sir", "No no, not
 * really", "नाही"), so a real answer that merely contains "no" never matches.
 */
const DECLINE_WORDS = new Set(
  [
    "no",
    "nope",
    "nah",
    "not",
    "nahi",
    "nahin",
    "nai",
    "nhi",
    "nako",
    "नहीं",
    "नही",
    "नाही",
    "नको",
    "இல்லை",
    "లేదు",
    "ಇಲ್ಲ",
    "না",
    "ના",
    "ഇല്ല",
    "ਨਹੀਂ",
    "ନା",
    "ନାହିଁ",
    "illa",
    "ledu",
    "nahin",
    "नो",
    "வேண்டாம்",
    "వద్దు",
    "ಬೇಡ",
    "નહીં",
    "വേണ്ട",
    "ନାଇଁ",
    "nako",
    "vendam",
    "vaddu",
    "beda",
  ].map(normalise),
);
/** Words allowed alongside the "no" without making it an answer. */
const DECLINE_FILLER = new Set(
  [
    "sir",
    "mam",
    "maam",
    "madam",
    "really",
    "thanks",
    "thank",
    "you",
    "please",
    "okay",
    "ok",
    "सर",
    "जी",
    "ਜੀ",
    "থাক",
    "ji",
    "ಸರ್",
    "சார்",
    "సార్",
    "স্যার",
    "સર",
    "സർ",
    "ਸਰ",
    "ସାର୍",
    "मैडम",
    "मॅडम",
  ].map(normalise),
);

export function isDeclineRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text) return false;
  const words = text.split(" ");
  if (words.length > 6) return false;
  return (
    words.some((w) => DECLINE_WORDS.has(w)) &&
    words.every((w) => DECLINE_WORDS.has(w) || DECLINE_FILLER.has(w))
  );
}

/**
 * "Pass" — only when it is the WHOLE utterance.
 *
 * Too common a word to match inside a sentence: "I want to pass my exam" is an
 * answer, not a skip.
 */
const EXACT_SKIP_PHRASES: string[] = [
  "pass",
  "i pass",
  "pass it",
  "pass this",
  "pass this one",
  "pass please",
  "पास",
  "पास करो",
  "पास कीजिए",
  // A bare "next" in a local script only on its own: "नेक्स्ट टाइम ध्यान
  // रखूंगा" (next time I will be careful) is a real answer.
  "नेक्स्ट",
  "நெக்ஸ்ட்",
  "నెక్స్ట్",
  "ನೆಕ್ಸ್ಟ್",
  "নেক্সট",
  "નેક્સ્ટ",
  "നെക്സ്റ്റ്",
  "ਨੈਕਸਟ",
  "ନେକ୍ସଟ",
  "नेक्स्ट प्लीज",
  "प्लीज नेक्स्ट",
];

export function isSkipRequest(transcript: string): boolean {
  const text = normalise(transcript);
  if (!text) return false;

  // Strong phrases mean skip at any length.
  if (STRONG_SKIP_PHRASES.some((p) => text.includes(normalise(p)))) return true;
  if (EXACT_SKIP_PHRASES.some((p) => text === normalise(p))) return true;

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
