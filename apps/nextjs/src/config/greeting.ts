import { INTERVIEW_LANGUAGES } from "./languages";
import type { InterviewLanguageKey } from "./languages";

/**
 * The language probe: turn 1 of every attempt.
 *
 * The opener is a warm-up, nothing more. It no longer asks their name or
 * what they do: both are collected before the interview starts (the details
 * step and the background box), and asking again made the first thing the
 * candidate heard a repeat of a form they had just filled in.
 *
 * The opener says nothing about language. Telling a
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
  "Hello {name}, and welcome. Let's start with something easy — what do you " +
  "enjoy most about what you are doing right now?";

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

/* -------------------------------------------------------------------------- */
/*                        Spoken openers, per language                        */
/* -------------------------------------------------------------------------- */

/**
 * The opener, written in each interview language.
 *
 * The candidate now chooses their language before the interview starts, so
 * the very first thing they hear should already be in it — greeting them in
 * English and only switching afterwards undoes the choice they just made.
 *
 * Hard-coded rather than translated at runtime on purpose. This is the first
 * impression, and a provider round-trip before the first word would add
 * seconds of silence to it; these eleven strings never change.
 *
 * Written the way people actually speak, keeping ordinary workplace words in
 * English (`interview`), matching the register rules the interviewer prompts
 * follow.
 */
export const PROBE_QUESTION_BY_LANGUAGE: Record<InterviewLanguageKey, string> =
  {
    english: PROBE_SPOKEN_TEXT,
    hindi:
      "नमस्ते {name}, आपका स्वागत है। शुरुआत कुछ आसान से करते हैं — अभी आप जो कर रहे हैं, उसमें आपको सबसे अच्छा क्या लगता है?",
    marathi:
      "नमस्कार {name}, तुमचं स्वागत आहे. सुरुवात सोप्या गोष्टीने करूया — सध्या तुम्ही जे करताय, त्यात तुम्हाला सगळ्यात जास्त काय आवडतं?",
    bengali:
      "নমস্কার {name}, আপনাকে স্বাগতম। সহজ কিছু দিয়েই শুরু করি — এখন আপনি যা করছেন, তার মধ্যে আপনার সবচেয়ে ভালো কী লাগে?",
    gujarati:
      "નમસ્તે {name}, તમારું સ્વાગત છે. શરૂઆત કંઈક સરળથી કરીએ — અત્યારે તમે જે કરો છો, તેમાં તમને સૌથી વધારે શું ગમે છે?",
    kannada:
      "ನಮಸ್ಕಾರ {name}, ಸ್ವಾಗತ. ಸುಲಭವಾದ ವಿಷಯದಿಂದಲೇ ಶುರು ಮಾಡೋಣ — ಈಗ ನೀವು ಏನು ಮಾಡ್ತಿದ್ದೀರೋ, ಅದರಲ್ಲಿ ನಿಮಗೆ ಅತೀ ಹೆಚ್ಚು ಇಷ್ಟವಾಗೋದು ಏನು?",
    malayalam:
      "നമസ്കാരം {name}, സ്വാഗതം. എളുപ്പമുള്ള ഒരു ചോദ്യത്തിൽ തുടങ്ങാം — ഇപ്പോൾ നിങ്ങൾ ചെയ്യുന്നതിൽ ഏറ്റവും ഇഷ്ടം എന്താണ്?",
    odia: "ନମସ୍କାର {name}, ସ୍ୱାଗତ। ସହଜ କିଛିରୁ ଆରମ୍ଭ କରିବା — ଏବେ ଆପଣ ଯାହା କରୁଛନ୍ତି, ସେଥିରେ ଆପଣଙ୍କୁ ସବୁଠାରୁ ଭଲ କଣ ଲାଗେ?",
    punjabi:
      "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {name}, ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਸ਼ੁਰੂਆਤ ਕਿਸੇ ਸੌਖੀ ਗੱਲ ਤੋਂ ਕਰਦੇ ਹਾਂ — ਹੁਣ ਤੁਸੀਂ ਜੋ ਕਰ ਰਹੇ ਹੋ, ਉਸ ਵਿੱਚ ਤੁਹਾਨੂੰ ਸਭ ਤੋਂ ਵੱਧ ਕੀ ਪਸੰਦ ਹੈ?",
    tamil:
      "வணக்கம் {name}, வரவேற்கிறோம். ஏதாவது சுலபமானதுல ஆரம்பிக்கலாம் — இப்போ நீங்க பண்றதுல உங்களுக்கு எது ரொம்ப பிடிக்கும்?",
    telugu:
      "నమస్కారం {name}, స్వాగతం. ఏదైనా సులభమైన దాంతో మొదలుపెడదాం — ఇప్పుడు మీరు చేస్తున్న దాంట్లో మీకు బాగా నచ్చేది ఏంటి?",
  };

/**
 * The opener with the candidate's name in it.
 *
 * Every opener carries a `{name}` slot right after the greeting, which is
 * where a name falls naturally in all eleven of these languages — "नमस्ते
 * Priya, आपका स्वागत है". The very first thing a nervous candidate hears is
 * their own name, which is the cheapest reassurance there is.
 *
 * The space goes with the slot when there is no name to put in it, so an
 * attempt created without one still reads as ordinary speech rather than
 * "Hello , and welcome".
 */
export function openerFor(
  language: InterviewLanguageKey,
  name: string | null,
): string {
  const template = PROBE_QUESTION_BY_LANGUAGE[language];
  return name
    ? template.replace("{name}", name)
    : template.replace(" {name}", "");
}

/**
 * Said when the candidate answers in a language they did not choose.
 *
 * Keyed by the language they are SPEAKING, not the one they picked — which
 * is the whole point. Telling somebody in Telugu that they should be
 * speaking Hindi is a message they can act on; telling them in Hindi is the
 * same failure they are already having.
 *
 * `{language}` is filled with the chosen language's own name, as it appears
 * in the picker, so the instruction and the menu agree.
 *
 * Warm, never a telling-off: the candidate has done nothing wrong, and the
 * interview carries on either way. It names both ways out — answer in the
 * chosen language, or switch the interview to this one — because a candidate
 * who is more comfortable here should not have to fight it.
 */
export const WRONG_LANGUAGE_NOTICE: Record<InterviewLanguageKey, string> = {
  english:
    "You chose {language} for this interview. Please carry on in {language}, or change the language yourself from the menu at the top.",
  hindi:
    "आपने इस interview के लिए {language} चुनी है। कृपया {language} में ही जवाब दीजिए, या ऊपर दिए मेन्यू से भाषा खुद बदल लीजिए।",
  marathi:
    "तुम्ही या interview साठी {language} निवडली आहे. कृपया {language} मध्येच उत्तर द्या, किंवा वरच्या मेन्यूमधून भाषा स्वतः बदला.",
  bengali:
    "আপনি এই interview-এর জন্য {language} বেছে নিয়েছেন। অনুগ্রহ করে {language}-এই উত্তর দিন, বা উপরের মেনু থেকে ভাষা নিজেই বদলে নিন।",
  gujarati:
    "તમે આ interview માટે {language} પસંદ કરી છે. કૃપા કરીને {language}માં જ જવાબ આપો, અથવા ઉપરના મેનુમાંથી ભાષા જાતે બદલો.",
  kannada:
    "ನೀವು ಈ interview ಗೆ {language} ಆಯ್ಕೆ ಮಾಡಿದ್ದೀರಿ. ದಯವಿಟ್ಟು {language} ದಲ್ಲೇ ಉತ್ತರಿಸಿ, ಅಥವಾ ಮೇಲಿನ ಮೆನುವಿನಿಂದ ಭಾಷೆಯನ್ನು ನೀವೇ ಬದಲಾಯಿಸಿ.",
  malayalam:
    "നിങ്ങൾ ഈ interview-ന് {language} തിരഞ്ഞെടുത്തിട്ടുണ്ട്. ദയവായി {language}-ൽ തന്നെ ഉത്തരം പറയൂ, അല്ലെങ്കിൽ മുകളിലെ മെനുവിൽ നിന്ന് ഭാഷ സ്വയം മാറ്റൂ.",
  odia: "ଆପଣ ଏହି interview ପାଇଁ {language} ବାଛିଛନ୍ତି। ଦୟାକରି {language}ରେ ହିଁ ଉତ୍ତର ଦିଅନ୍ତୁ, କିମ୍ବା ଉପରର ମେନୁରୁ ଭାଷା ନିଜେ ବଦଳାନ୍ତୁ।",
  punjabi:
    "ਤੁਸੀਂ ਇਸ interview ਲਈ {language} ਚੁਣੀ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ {language} ਵਿੱਚ ਹੀ ਜਵਾਬ ਦਿਓ, ਜਾਂ ਉੱਪਰਲੇ ਮੀਨੂ ਤੋਂ ਭਾਸ਼ਾ ਆਪ ਬਦਲ ਲਵੋ।",
  tamil:
    "நீங்க இந்த interview-க்கு {language} தேர்ந்தெடுத்திருக்கீங்க. தயவுசெய்து {language}-லயே பதில் சொல்லுங்க, இல்லைன்னா மேல இருக்கற மெனுல மொழிய நீங்களே மாத்திக்கோங்க.",
  telugu:
    "మీరు ఈ interview కోసం {language} ఎంచుకున్నారు. దయచేసి {language} లోనే సమాధానం చెప్పండి, లేదా పైన ఉన్న మెనూ నుండి భాషను మీరే మార్చుకోండి.",
};

/**
 * The notice, in the language being spoken, naming the language that was
 * chosen.
 */
export function wrongLanguageNoticeFor(
  spoken: InterviewLanguageKey,
  chosen: InterviewLanguageKey,
): string {
  return WRONG_LANGUAGE_NOTICE[spoken].replaceAll(
    "{language}",
    INTERVIEW_LANGUAGES[chosen].displayName,
  );
}
