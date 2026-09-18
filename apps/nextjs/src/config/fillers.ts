import type { InterviewLanguageKey } from "./languages";

/**
 * The short things the interviewer says that are not questions.
 *
 * Fixed text, so unlike a question these never depend on the candidate. That
 * is the whole reason they live here: the same forty-odd lines serve every
 * interview ever run, so they are voiced once per language and reused, rather
 * than re-synthesised for each attempt. `PROBE_QUESTION_BY_LANGUAGE` in
 * `./greeting` already establishes the pattern.
 *
 * Why each exists:
 *
 * - `okay` fills the gap the moment an answer ends. Without it the candidate
 *   finishes speaking into silence while the answer uploads and transcribes,
 *   which reads as the interview having stopped listening.
 * - `takeYourTime` and `noProblem` are the 7-second and 30-second rungs of the
 *   silence ladder: one reassures, one lets them off the hook and moves on.
 * - `addMore` is asked once when an answer was a word or two — the difference
 *   between a candidate who has finished and one who has not started.
 * - `closing` ends the interview out loud, instead of the screen simply
 *   changing.
 *
 * Several variants where the line is heard repeatedly. A candidate hears
 * `okay` after every single answer, and the same syllable eleven times is the
 * thing that makes an interviewer sound like a machine — the specific
 * complaint that got the old fixed acknowledgement removed.
 */

export type FillerKind =
  "okay" | "takeYourTime" | "noProblem" | "addMore" | "closing";

type FillerSet = Record<FillerKind, string[]>;

export const FILLERS: Record<InterviewLanguageKey, FillerSet> = {
  english: {
    okay: ["Okay.", "Right.", "Got it.", "Thank you.", "Mm-hmm."],
    takeYourTime: ["Take your time.", "No rush — think about it."],
    noProblem: [
      "No problem, let's move on.",
      "That's alright, let's continue.",
    ],
    addMore: [
      "Would you like to add anything?",
      "Anything else you want to say about that?",
      "Is there more you would like to tell me?",
      "Would you like to say a little more?",
    ],
    closing: [
      "That is the end of the interview. Thank you for your time — we will get back to you soon.",
    ],
  },

  hindi: {
    okay: ["ठीक है।", "अच्छा।", "समझ गया।", "धन्यवाद।", "हाँ।"],
    takeYourTime: ["आराम से सोचिए।", "कोई जल्दी नहीं है, सोच लीजिए।"],
    noProblem: ["कोई बात नहीं, आगे बढ़ते हैं।", "ठीक है, अगला सवाल लेते हैं।"],
    addMore: [
      "कुछ और जोड़ना चाहेंगे?",
      "इसके बारे में और कुछ कहना है?",
      "और कुछ बताना चाहेंगे?",
      "थोड़ा और कहना चाहेंगे?",
    ],
    closing: [
      "इंटरव्यू यहीं पूरा हुआ। आपके समय के लिए धन्यवाद — हम जल्दी ही आपसे संपर्क करेंगे।",
    ],
  },

  marathi: {
    okay: ["ठीक आहे.", "बरं.", "समजलं.", "धन्यवाद.", "हो."],
    takeYourTime: ["सावकाश विचार करा.", "घाई नाही, विचार करा."],
    noProblem: ["काही हरकत नाही, पुढे जाऊया.", "ठीक आहे, पुढचा प्रश्न घेऊया."],
    addMore: [
      "आणखी काही सांगायचं आहे का?",
      "याबद्दल आणखी काही सांगाल का?",
      "अजून काही जोडायचं आहे का?",
      "थोडं आणखी सांगाल का?",
    ],
    closing: [
      "इंटरव्यू इथेच पूर्ण झाला. तुमच्या वेळेबद्दल धन्यवाद — आम्ही लवकरच तुमच्याशी संपर्क साधू.",
    ],
  },

  bengali: {
    okay: ["ঠিক আছে।", "আচ্ছা।", "বুঝলাম।", "ধন্যবাদ।", "হ্যাঁ।"],
    takeYourTime: ["ধীরে সুস্থে ভাবুন।", "তাড়াহুড়ো নেই, ভেবে নিন।"],
    noProblem: ["কোনও সমস্যা নেই, এগিয়ে যাই।", "ঠিক আছে, পরেরটায় যাই।"],
    addMore: [
      "আর কিছু বলতে চান?",
      "এই নিয়ে আর কিছু বলবেন?",
      "আর কিছু যোগ করতে চান?",
      "একটু বেশি বলবেন?",
    ],
    closing: [
      "ইন্টারভিউ এখানেই শেষ। আপনার সময়ের জন্য ধন্যবাদ — আমরা শীঘ্রই যোগাযোগ করব।",
    ],
  },

  gujarati: {
    okay: ["બરાબર.", "સારું.", "સમજ્યો.", "આભાર.", "હા."],
    takeYourTime: ["શાંતિથી વિચારો.", "ઉતાવળ નથી, વિચારી લો."],
    noProblem: ["કોઈ વાંધો નથી, આગળ વધીએ.", "ઠીક છે, આગળનો પ્રશ્ન લઈએ."],
    addMore: [
      "બીજું કંઈ ઉમેરવું છે?",
      "આ વિશે બીજું કંઈ કહેશો?",
      "બીજું કંઈ કહેવું છે?",
      "થોડું વધારે કહેશો?",
    ],
    closing: [
      "ઇન્ટરવ્યૂ અહીં પૂરો થયો. તમારા સમય બદલ આભાર — અમે જલદી સંપર્ક કરીશું.",
    ],
  },

  kannada: {
    okay: ["ಸರಿ.", "ಆಯ್ತು.", "ಅರ್ಥವಾಯಿತು.", "ಧನ್ಯವಾದ.", "ಹೌದು."],
    takeYourTime: ["ನಿಧಾನವಾಗಿ ಯೋಚಿಸಿ.", "ಅವಸರವಿಲ್ಲ, ಯೋಚಿಸಿ."],
    noProblem: ["ಪರವಾಗಿಲ್ಲ, ಮುಂದೆ ಹೋಗೋಣ.", "ಸರಿ, ಮುಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗೋಣ."],
    addMore: [
      "ಇನ್ನೇನಾದರೂ ಸೇರಿಸಬೇಕೆ?",
      "ಇದರ ಬಗ್ಗೆ ಇನ್ನೇನಾದರೂ ಹೇಳ್ತೀರಾ?",
      "ಇನ್ನೇನಾದರೂ ಹೇಳಬೇಕೆ?",
      "ಸ್ವಲ್ಪ ಹೆಚ್ಚು ಹೇಳ್ತೀರಾ?",
    ],
    closing: [
      "ಸಂದರ್ಶನ ಇಲ್ಲಿಗೆ ಮುಗಿಯಿತು. ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ಧನ್ಯವಾದ — ಶೀಘ್ರದಲ್ಲೇ ಸಂಪರ್ಕಿಸುತ್ತೇವೆ.",
    ],
  },

  malayalam: {
    okay: ["ശരി.", "ഓക്കെ.", "മനസ്സിലായി.", "നന്ദി.", "ഉവ്വ്."],
    takeYourTime: ["സാവധാനം ആലോചിക്കൂ.", "തിരക്കില്ല, ആലോചിക്കൂ."],
    noProblem: ["കുഴപ്പമില്ല, മുന്നോട്ട് പോകാം.", "ശരി, അടുത്തതിലേക്ക് പോകാം."],
    addMore: [
      "വേറെ എന്തെങ്കിലും പറയാനുണ്ടോ?",
      "ഇതിനെക്കുറിച്ച് കൂടുതൽ പറയാമോ?",
      "വേറെ എന്തെങ്കിലും ചേർക്കണോ?",
      "കുറച്ചുകൂടി പറയാമോ?",
    ],
    closing: [
      "അഭിമുഖം ഇവിടെ അവസാനിക്കുന്നു. സമയത്തിന് നന്ദി — ഞങ്ങൾ ഉടൻ ബന്ധപ്പെടും.",
    ],
  },

  odia: {
    okay: ["ଠିକ ଅଛି।", "ଆଚ୍ଛା।", "ବୁଝିଲି।", "ଧନ୍ୟବାଦ।", "ହଁ।"],
    takeYourTime: ["ଧୀରେ ଭାବନ୍ତୁ।", "ତରବର ନାହିଁ, ଭାବି ନିଅନ୍ତୁ।"],
    noProblem: [
      "କିଛି ଅସୁବିଧା ନାହିଁ, ଆଗକୁ ଯିବା।",
      "ଠିକ ଅଛି, ପରବର୍ତ୍ତୀ ପ୍ରଶ୍ନକୁ ଯିବା।",
    ],
    addMore: [
      "ଆଉ କିଛି କହିବେ କି?",
      "ଏ ବିଷୟରେ ଆଉ କିଛି କହିବେ?",
      "ଆଉ କିଛି ଯୋଡ଼ିବେ କି?",
      "ଟିକେ ଅଧିକ କହିବେ କି?",
    ],
    closing: [
      "ସାକ୍ଷାତକାର ଏଠାରେ ଶେଷ। ଆପଣଙ୍କ ସମୟ ପାଇଁ ଧନ୍ୟବାଦ — ଆମେ ଶୀଘ୍ର ଯୋଗାଯୋଗ କରିବୁ।",
    ],
  },

  punjabi: {
    okay: ["ਠੀਕ ਹੈ।", "ਅੱਛਾ।", "ਸਮਝ ਗਿਆ।", "ਧੰਨਵਾਦ।", "ਹਾਂ।"],
    takeYourTime: ["ਆਰਾਮ ਨਾਲ ਸੋਚੋ।", "ਕੋਈ ਕਾਹਲੀ ਨਹੀਂ, ਸੋਚ ਲਵੋ।"],
    noProblem: ["ਕੋਈ ਗੱਲ ਨਹੀਂ, ਅੱਗੇ ਵਧਦੇ ਹਾਂ।", "ਠੀਕ ਹੈ, ਅਗਲਾ ਸਵਾਲ ਲੈਂਦੇ ਹਾਂ।"],
    addMore: [
      "ਕੁਝ ਹੋਰ ਦੱਸਣਾ ਚਾਹੋਗੇ?",
      "ਇਸ ਬਾਰੇ ਹੋਰ ਕੁਝ ਕਹੋਗੇ?",
      "ਹੋਰ ਕੁਝ ਜੋੜਨਾ ਹੈ?",
      "ਥੋੜ੍ਹਾ ਹੋਰ ਦੱਸੋਗੇ?",
    ],
    closing: [
      "ਇੰਟਰਵਿਊ ਇੱਥੇ ਪੂਰਾ ਹੋਇਆ। ਤੁਹਾਡੇ ਸਮੇਂ ਲਈ ਧੰਨਵਾਦ — ਅਸੀਂ ਜਲਦੀ ਸੰਪਰਕ ਕਰਾਂਗੇ।",
    ],
  },

  tamil: {
    okay: ["சரி.", "ஓகே.", "புரிஞ்சுது.", "நன்றி.", "ஆமா."],
    takeYourTime: ["நிதானமா யோசிங்க.", "அவசரம் இல்ல, யோசிச்சு சொல்லுங்க."],
    noProblem: ["பரவாயில்ல, அடுத்ததுக்கு போகலாம்.", "சரி, தொடர்ந்து போகலாம்."],
    addMore: [
      "வேற ஏதாவது சொல்ல விரும்புறீங்களா?",
      "இதப் பத்தி இன்னும் ஏதாவது சொல்வீங்களா?",
      "வேற ஏதாவது சேர்க்கணுமா?",
      "கொஞ்சம் அதிகமா சொல்வீங்களா?",
    ],
    closing: [
      "நேர்காணல் இத்தோட முடிஞ்சது. உங்க நேரத்துக்கு நன்றி — நாங்க சீக்கிரம் தொடர்பு கொள்வோம்.",
    ],
  },

  telugu: {
    okay: ["సరే.", "ఓకే.", "అర్థమైంది.", "ధన్యవాదాలు.", "అవును."],
    takeYourTime: ["నిదానంగా ఆలోచించండి.", "తొందరేమీ లేదు, ఆలోచించండి."],
    noProblem: [
      "ఏం పర్వాలేదు, ముందుకు వెళ్దాం.",
      "సరే, తర్వాతి ప్రశ్నకి వెళ్దాం.",
    ],
    addMore: [
      "ఇంకేమైనా చెప్పాలనుకుంటున్నారా?",
      "దీని గురించి ఇంకేమైనా చెప్తారా?",
      "ఇంకేమైనా జోడించాలా?",
      "కొంచెం ఎక్కువ చెప్తారా?",
    ],
    closing: [
      "ఇంటర్వ్యూ ఇక్కడితో పూర్తయింది. మీ సమయానికి ధన్యవాదాలు — మేము త్వరలో సంప్రదిస్తాం.",
    ],
  },
};

/**
 * Pick a filler, avoiding the one heard last.
 *
 * `seed` is normally something that already varies per turn — the turn number,
 * the directive sequence — so the choice is deterministic for a given moment
 * but different between moments. Deterministic matters: the same poll can
 * resolve the same directive twice, and the candidate should not hear the
 * wording change under them.
 */
export function pickFiller(
  language: InterviewLanguageKey,
  kind: FillerKind,
  seed: number,
): string {
  const options = FILLERS[language][kind];
  return options[Math.abs(seed) % options.length] ?? options[0]!;
}
