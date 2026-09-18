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
  return name ? template.replace("{name}", name) : template.replace(" {name}", "");
}

/**
 * Said when the candidate answers in a language they did not choose.
 *
 * Warm, never a telling-off: the candidate has done nothing wrong, and the
 * interview carries on either way — this only asks them to stay in the
 * language the rest of the interview is written in, so their answers are
 * transcribed and scored against the same yardstick.
 *
 * Written in the CHOSEN language, because that is the language the
 * interviewer is speaking, and hearing it spoken is itself the reminder.
 */
export const WRONG_LANGUAGE_NOTICE: Record<InterviewLanguageKey, string> = {
  english:
    "No problem at all. You chose English for this interview, so please carry on in English.",
  hindi:
    "कोई बात नहीं। आपने इस interview के लिए हिंदी चुनी है, तो आगे भी हिंदी में ही जवाब दीजिए।",
  marathi:
    "काही हरकत नाही. तुम्ही या interview साठी मराठी निवडली आहे, त्यामुळे पुढेही मराठीतच उत्तर द्या.",
  bengali:
    "কোনও সমস্যা নেই। আপনি এই interview-এর জন্য বাংলা বেছে নিয়েছেন, তাই বাকিটাও বাংলাতেই বলুন।",
  gujarati:
    "કોઈ વાંધો નથી. તમે આ interview માટે ગુજરાતી પસંદ કરી છે, તો આગળ પણ ગુજરાતીમાં જ જવાબ આપો.",
  kannada:
    "ಪರವಾಗಿಲ್ಲ. ನೀವು ಈ interview ಗೆ ಕನ್ನಡ ಆಯ್ಕೆ ಮಾಡಿದ್ದೀರಿ, ಹಾಗಾಗಿ ಮುಂದೆಯೂ ಕನ್ನಡದಲ್ಲೇ ಉತ್ತರಿಸಿ.",
  malayalam:
    "കുഴപ്പമില്ല. നിങ്ങൾ ഈ interview-ന് മലയാളം തിരഞ്ഞെടുത്തിട്ടുണ്ട്, അതുകൊണ്ട് ബാക്കിയും മലയാളത്തിൽ തന്നെ പറയൂ.",
  odia: "କିଛି ଅସୁବିଧା ନାହିଁ। ଆପଣ ଏହି interview ପାଇଁ ଓଡ଼ିଆ ବାଛିଛନ୍ତି, ତେଣୁ ଆଗକୁ ମଧ୍ୟ ଓଡ଼ିଆରେ ଉତ୍ତର ଦିଅନ୍ତୁ।",
  punjabi:
    "ਕੋਈ ਗੱਲ ਨਹੀਂ। ਤੁਸੀਂ ਇਸ interview ਲਈ ਪੰਜਾਬੀ ਚੁਣੀ ਹੈ, ਇਸ ਲਈ ਅੱਗੇ ਵੀ ਪੰਜਾਬੀ ਵਿੱਚ ਹੀ ਜਵਾਬ ਦਿਓ।",
  tamil:
    "பரவாயில்லை. நீங்கள் இந்த interview-க்கு தமிழ் தேர்ந்தெடுத்திருக்கீங்க, அதனால மீதியும் தமிழ்லயே சொல்லுங்க.",
  telugu:
    "ఏం పర్వాలేదు. మీరు ఈ interview కి తెలుగు ఎంచుకున్నారు, కాబట్టి మిగతాది కూడా తెలుగులోనే చెప్పండి.",
};
