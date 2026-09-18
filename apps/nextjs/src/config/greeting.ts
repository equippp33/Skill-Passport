import { INTERVIEW_LANGUAGES } from "./languages";
import type { InterviewLanguageKey } from "./languages";

/**
 * The language probe: turn 1 of every attempt.
 *
 * The opener is asked in English and says nothing about language. Telling a
 * candidate to "answer in whichever language you like" makes the choice feel
 * like a test in itself; a real interviewer just asks the question. Whatever
 * language the candidate replies in is the answer, and Sarvam identifies it
 * from that reply — so the detection works exactly the same without the
 * instruction.
 *
 * It is NOT scored — it exists to hear the candidate speak.
 */

/** Spoken aloud for the probe, before any language is known. */
export const PROBE_SPOKEN_LANGUAGE_CODE = INTERVIEW_LANGUAGES.english.code;

export const PROBE_SPOKEN_TEXT =
  "Hello, and welcome to your interview. To begin, please tell me your name " +
  "and a little about the work you have done.";

/**
 * Shown on the pre-start page, NOT with the question itself.
 *
 * The reassurance that any language is welcome belongs before the interview
 * begins, where it is context. Inside the interview it would be an
 * instruction attached to the first question — see the note above.
 *
 * A candidate who does not read English still sees it in a script they
 * recognise. Kept short on purpose.
 */
export const PROBE_PROMPTS: { code: string; text: string }[] = [
  {
    code: "en-IN",
    text: "Answer in whichever language you are comfortable with. Tell us your name and a little about your work.",
  },
  {
    code: "hi-IN",
    text: "आप जिस भाषा में सहज हों, उसी में जवाब दें। अपना नाम और अपने काम के बारे में थोड़ा बताइए।",
  },
  {
    code: "mr-IN",
    text: "तुम्हाला ज्या भाषेत सोपे वाटते त्या भाषेत उत्तर द्या. तुमचे नाव आणि तुमच्या कामाबद्दल थोडे सांगा.",
  },
  {
    code: "ta-IN",
    text: "உங்களுக்கு வசதியான மொழியில் பதிலளியுங்கள். உங்கள் பெயரையும் உங்கள் வேலையையும் சொல்லுங்கள்.",
  },
  {
    code: "te-IN",
    text: "మీకు సౌకర్యంగా ఉన్న భాషలో సమాధానం ఇవ్వండి. మీ పేరు మరియు మీ పని గురించి చెప్పండి.",
  },
  {
    code: "bn-IN",
    text: "আপনি যে ভাষায় স্বচ্ছন্দ সেই ভাষাতেই উত্তর দিন। আপনার নাম ও কাজের কথা বলুন।",
  },
  {
    code: "kn-IN",
    text: "ನಿಮಗೆ ಅನುಕೂಲವಾದ ಭಾಷೆಯಲ್ಲಿ ಉತ್ತರಿಸಿ. ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಕೆಲಸದ ಬಗ್ಗೆ ಹೇಳಿ.",
  },
  {
    code: "gu-IN",
    text: "તમને અનુકૂળ હોય તે ભાષામાં જવાબ આપો. તમારું નામ અને તમારા કામ વિશે થોડું કહો.",
  },
];

/** Stored as the probe turn's question text. */
export const PROBE_QUESTION_TEXT = PROBE_SPOKEN_TEXT;

/**
 * Short interviewer fillers, played the instant the candidate stops so the
 * processing gap feels like a reply, not dead air. A few per language, rotated
 * at random so it never sounds like a recording. Deliberately NOT "thank you" —
 * these are the natural little things a real interviewer says between answers:
 * an acknowledgement, a "let me see", and an invitation to add more.
 *
 * Confident for English / Hindi / Marathi / Telugu; have a native speaker
 * eyeball the rest before shipping widely.
 */
export const FILLERS_BY_KEY: Record<InterviewLanguageKey, string[]> = {
  english: ["Okay.", "Alright, let me see.", "Got it — anything you'd like to add?"],
  hindi: ["ठीक है।", "अच्छा, ज़रा देखते हैं।", "समझ गया — कुछ और जोड़ना चाहेंगे?"],
  marathi: ["ठीक आहे.", "बरं, जरा बघूया.", "समजलं — आणखी काही सांगायचंय का?"],
  bengali: ["ঠিক আছে।", "আচ্ছা, দেখি।", "বুঝলাম — আর কিছু যোগ করতে চান?"],
  gujarati: ["બરાબર.", "સારું, જોઈએ.", "સમજ્યું — બીજું કંઈ ઉમેરવું છે?"],
  kannada: ["ಸರಿ.", "ಆಯ್ತು, ನೋಡೋಣ.", "ಅರ್ಥವಾಯಿತು — ಇನ್ನೇನಾದರೂ ಸೇರಿಸಬೇಕೆ?"],
  malayalam: ["ശരി.", "ശരി, നോക്കാം.", "മനസ്സിലായി — വേറെ എന്തെങ്കിലും ചേർക്കാനുണ്ടോ?"],
  odia: ["ଠିକ୍ ଅଛି।", "ଆଚ୍ଛା, ଦେଖିବା।", "ବୁଝିଲି — ଆଉ କିଛି କହିବେ କି?"],
  punjabi: ["ਠੀਕ ਹੈ।", "ਚੰਗਾ, ਵੇਖਦੇ ਹਾਂ।", "ਸਮਝ ਗਿਆ — ਹੋਰ ਕੁਝ ਦੱਸਣਾ ਚਾਹੋਗੇ?"],
  tamil: ["சரி.", "சரி, பார்க்கலாம்.", "புரிந்தது — வேறு ஏதாவது சொல்ல வேண்டுமா?"],
  telugu: ["సరే.", "అలాగే, చూద్దాం.", "అర్థమైంది — ఇంకేమైనా చెప్పాలనుకుంటున్నారా?"],
};

/**
 * "Take your time" — the gentle first nudge when a candidate goes quiet, before
 * the question is repeated and, failing that, skipped. One per language, cached
 * exactly like the fillers.
 */
export const TAKE_YOUR_TIME_BY_KEY: Record<InterviewLanguageKey, string> = {
  english: "Take your time, there's no rush.",
  hindi: "आराम से सोचिए, कोई जल्दी नहीं है।",
  marathi: "आरामात विचार करा, काही घाई नाही.",
  bengali: "সময় নিন, কোনো তাড়া নেই।",
  gujarati: "આરામથી વિચારો, કોઈ ઉતાવળ નથી.",
  kannada: "ನಿಧಾನವಾಗಿ ಯೋಚಿಸಿ, ಯಾವುದೇ ಆತುರವಿಲ್ಲ.",
  malayalam: "സാവധാനം ആലോചിക്കൂ, തിടുക്കമില്ല.",
  odia: "ଧୀରେ ଭାବନ୍ତୁ, କୌଣସି ତରାତରି ନାହିଁ।",
  punjabi: "ਆਰਾਮ ਨਾਲ ਸੋਚੋ, ਕੋਈ ਕਾਹਲੀ ਨਹੀਂ।",
  tamil: "நிதானமாக யோசியுங்கள், அவசரம் இல்லை.",
  telugu: "నిదానంగా ఆలోచించండి, తొందర ఏమీ లేదు.",
};

/**
 * The opening question, per language.
 *
 * The candidate now picks their language before the interview, so the opener is
 * spoken in it from the very first word — a warm greeting plus "tell me your
 * name and a little about yourself". It still captures the introduction we use
 * to ground later questions; it is no longer a language probe. Kept short and
 * simple, fresher-friendly (studies count, not just work).
 */
export const OPENING_BY_KEY: Record<InterviewLanguageKey, string> = {
  english:
    "Hello, and welcome! To start, please tell me your name and a little about yourself.",
  hindi:
    "नमस्ते! शुरू करने के लिए, अपना नाम बताइए और अपने बारे में थोड़ा बताइए।",
  marathi:
    "नमस्कार! सुरुवात करण्यासाठी, तुमचं नाव आणि तुमच्याबद्दल थोडं सांगा.",
  bengali:
    "নমস্কার! শুরু করতে, আপনার নাম এবং নিজের সম্পর্কে একটু বলুন।",
  gujarati:
    "નમસ્તે! શરૂ કરવા માટે, તમારું નામ અને તમારા વિશે થોડું કહો.",
  kannada:
    "ನಮಸ್ಕಾರ! ಪ್ರಾರಂಭಿಸಲು, ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ನಿಮ್ಮ ಬಗ್ಗೆ ಸ್ವಲ್ಪ ಹೇಳಿ.",
  malayalam:
    "നമസ്കാരം! തുടങ്ങാൻ, നിങ്ങളുടെ പേരും നിങ്ങളെക്കുറിച്ച് കുറച്ചും പറയൂ.",
  odia: "ନମସ୍କାର! ଆରମ୍ଭ କରିବାକୁ, ଆପଣଙ୍କ ନାମ ଏବଂ ନିଜ ବିଷୟରେ କିଛି କୁହନ୍ତୁ।",
  punjabi:
    "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਸ਼ੁਰੂ ਕਰਨ ਲਈ, ਆਪਣਾ ਨਾਮ ਅਤੇ ਆਪਣੇ ਬਾਰੇ ਥੋੜ੍ਹਾ ਦੱਸੋ।",
  tamil:
    "வணக்கம்! தொடங்குவதற்கு, உங்கள் பெயரையும் உங்களைப் பற்றி சிறிது சொல்லுங்கள்.",
  telugu:
    "నమస్కారం! ప్రారంభించడానికి, మీ పేరు మరియు మీ గురించి కొంచెం చెప్పండి.",
};
