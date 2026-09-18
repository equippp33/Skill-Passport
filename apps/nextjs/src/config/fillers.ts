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
 * - `whatHappened`, `didNotGet` and `noProblem` are the rungs of the silence
 *   ladder. The first checks the candidate is still there, by name. The second
 *   asks whether the question landed — worth asking out loud, because "no"
 *   routes straight to the simpler wording through the ordinary phrase
 *   matching. The third stops waiting.
 * - `addMore` is asked once when an answer was a word or two — the difference
 *   between a candidate who has finished and one who has not started — and
 *   `goAhead` is the reply when they say yes, they do have more.
 * - `areYouOkay` answers a cough, a sneeze, a cleared throat: the microphone
 *   heard something and the transcriber found no words in it. Noticing that
 *   out loud is most of what separates an interviewer from a form.
 * - `closing` ends the interview out loud, instead of the screen simply
 *   changing.
 *
 * `{name}` in a line is replaced with the candidate's first name when the
 * clips are written, which is per attempt — being asked "Priya, is everything
 * alright?" is the difference between a machine timing out and somebody
 * noticing you have gone quiet.
 *
 * Several variants where the line is heard repeatedly. A candidate hears
 * `okay` after every single answer, and the same syllable eleven times is the
 * thing that makes an interviewer sound like a machine — the specific
 * complaint that got the old fixed acknowledgement removed.
 */

export type FillerKind =
  | "okay"
  | "whatHappened"
  | "didNotGet"
  | "noProblem"
  | "addMore"
  | "goAhead"
  | "areYouOkay"
  | "closing";

type FillerSet = Record<FillerKind, string[]>;

export const FILLERS: Record<InterviewLanguageKey, FillerSet> = {
  english: {
    okay: ["Okay.", "Right.", "Got it.", "Thank you.", "Mm-hmm."],
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
    whatHappened: [
      "{name}, is everything alright?",
      "{name}, are you still with me?",
    ],
    didNotGet: [
      "Did you not follow the question?",
      "Was the question not clear?",
    ],
    goAhead: ["Please go ahead.", "Yes, tell me."],
    areYouOkay: [
      "Are you alright, {name}? Take your time.",
      "{name}, are you okay? No rush.",
    ],
    closing: [
      "That is the end of the interview. Thank you for your time — we will get back to you soon.",
    ],
  },

  hindi: {
    okay: ["ठीक है।", "अच्छा।", "समझ गया।", "धन्यवाद।", "हाँ।"],
    noProblem: ["कोई बात नहीं, आगे बढ़ते हैं।", "ठीक है, अगला सवाल लेते हैं।"],
    addMore: [
      "कुछ और जोड़ना चाहेंगे?",
      "इसके बारे में और कुछ कहना है?",
      "और कुछ बताना चाहेंगे?",
      "थोड़ा और कहना चाहेंगे?",
    ],
    whatHappened: ["{name}, सब ठीक है?", "{name}, आप सुन पा रहे हैं?"],
    didNotGet: ["क्या सवाल समझ नहीं आया?", "सवाल साफ़ नहीं था क्या?"],
    goAhead: ["हाँ, बताइए।", "जी, कहिए।"],
    areYouOkay: [
      "{name}, आप ठीक हैं? आराम से लीजिए।",
      "सब ठीक है ना {name}? कोई जल्दी नहीं।",
    ],
    closing: [
      "इंटरव्यू यहीं पूरा हुआ। आपके समय के लिए धन्यवाद — हम जल्दी ही आपसे संपर्क करेंगे।",
    ],
  },

  marathi: {
    okay: ["ठीक आहे.", "बरं.", "समजलं.", "धन्यवाद.", "हो."],
    noProblem: ["काही हरकत नाही, पुढे जाऊया.", "ठीक आहे, पुढचा प्रश्न घेऊया."],
    addMore: [
      "आणखी काही सांगायचं आहे का?",
      "याबद्दल आणखी काही सांगाल का?",
      "अजून काही जोडायचं आहे का?",
      "थोडं आणखी सांगाल का?",
    ],
    whatHappened: [
      "{name}, सगळं ठीक आहे ना?",
      "{name}, तुम्हाला ऐकू येतंय ना?",
    ],
    didNotGet: ["प्रश्न समजला नाही का?", "प्रश्न स्पष्ट नव्हता का?"],
    goAhead: ["हो, सांगा.", "बोला, मी ऐकतोय."],
    areYouOkay: [
      "{name}, तुम्ही ठीक आहात ना? आरामात घ्या.",
      "सगळं ठीक आहे ना {name}? घाई नाही.",
    ],
    closing: [
      "इंटरव्यू इथेच पूर्ण झाला. तुमच्या वेळेबद्दल धन्यवाद — आम्ही लवकरच तुमच्याशी संपर्क साधू.",
    ],
  },

  bengali: {
    okay: ["ঠিক আছে।", "আচ্ছা।", "বুঝলাম।", "ধন্যবাদ।", "হ্যাঁ।"],
    noProblem: ["কোনও সমস্যা নেই, এগিয়ে যাই।", "ঠিক আছে, পরেরটায় যাই।"],
    addMore: [
      "আর কিছু বলতে চান?",
      "এই নিয়ে আর কিছু বলবেন?",
      "আর কিছু যোগ করতে চান?",
      "একটু বেশি বলবেন?",
    ],
    whatHappened: ["{name}, সব ঠিক আছে তো?", "{name}, আপনি শুনতে পাচ্ছেন?"],
    didNotGet: ["প্রশ্নটা কি বুঝতে পারেননি?", "প্রশ্নটা কি পরিষ্কার হয়নি?"],
    goAhead: ["হ্যাঁ, বলুন।", "বলুন, আমি শুনছি।"],
    areYouOkay: [
      "{name}, আপনি ঠিক আছেন তো? ধীরে সুস্থে নিন।",
      "সব ঠিক আছে তো {name}? তাড়াহুড়ো নেই।",
    ],
    closing: [
      "ইন্টারভিউ এখানেই শেষ। আপনার সময়ের জন্য ধন্যবাদ — আমরা শীঘ্রই যোগাযোগ করব।",
    ],
  },

  gujarati: {
    okay: ["બરાબર.", "સારું.", "સમજ્યો.", "આભાર.", "હા."],
    noProblem: ["કોઈ વાંધો નથી, આગળ વધીએ.", "ઠીક છે, આગળનો પ્રશ્ન લઈએ."],
    addMore: [
      "બીજું કંઈ ઉમેરવું છે?",
      "આ વિશે બીજું કંઈ કહેશો?",
      "બીજું કંઈ કહેવું છે?",
      "થોડું વધારે કહેશો?",
    ],
    whatHappened: ["{name}, બધું બરાબર છે?", "{name}, તમને સંભળાય છે?"],
    didNotGet: ["પ્રશ્ન સમજાયો નહીં?", "પ્રશ્ન સ્પષ્ટ નહોતો?"],
    goAhead: ["હા, કહો.", "બોલો, હું સાંભળું છું."],
    areYouOkay: [
      "{name}, તમે ઠીક છો ને? આરામથી લો.",
      "બધું બરાબર છે ને {name}? ઉતાવળ નથી.",
    ],
    closing: [
      "ઇન્ટરવ્યૂ અહીં પૂરો થયો. તમારા સમય બદલ આભાર — અમે જલદી સંપર્ક કરીશું.",
    ],
  },

  kannada: {
    okay: ["ಸರಿ.", "ಆಯ್ತು.", "ಅರ್ಥವಾಯಿತು.", "ಧನ್ಯವಾದ.", "ಹೌದು."],
    noProblem: ["ಪರವಾಗಿಲ್ಲ, ಮುಂದೆ ಹೋಗೋಣ.", "ಸರಿ, ಮುಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗೋಣ."],
    addMore: [
      "ಇನ್ನೇನಾದರೂ ಸೇರಿಸಬೇಕೆ?",
      "ಇದರ ಬಗ್ಗೆ ಇನ್ನೇನಾದರೂ ಹೇಳ್ತೀರಾ?",
      "ಇನ್ನೇನಾದರೂ ಹೇಳಬೇಕೆ?",
      "ಸ್ವಲ್ಪ ಹೆಚ್ಚು ಹೇಳ್ತೀರಾ?",
    ],
    whatHappened: ["{name}, ಎಲ್ಲಾ ಸರಿ ಇದೆಯಾ?", "{name}, ನಿಮಗೆ ಕೇಳಿಸ್ತಾ ಇದೆಯಾ?"],
    didNotGet: ["ಪ್ರಶ್ನೆ ಅರ್ಥ ಆಗಲಿಲ್ಲವಾ?", "ಪ್ರಶ್ನೆ ಸ್ಪಷ್ಟವಾಗಿ ಇರಲಿಲ್ಲವಾ?"],
    goAhead: ["ಹೌದು, ಹೇಳಿ.", "ಹೇಳಿ, ನಾನು ಕೇಳ್ತಾ ಇದ್ದೀನಿ."],
    areYouOkay: [
      "{name}, ನೀವು ಸರಿ ಇದ್ದೀರಾ? ನಿಧಾನವಾಗಿ ತಗೊಳ್ಳಿ.",
      "ಎಲ್ಲಾ ಸರಿ ಇದೆಯಾ {name}? ಅವಸರವಿಲ್ಲ.",
    ],
    closing: [
      "ಸಂದರ್ಶನ ಇಲ್ಲಿಗೆ ಮುಗಿಯಿತು. ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ಧನ್ಯವಾದ — ಶೀಘ್ರದಲ್ಲೇ ಸಂಪರ್ಕಿಸುತ್ತೇವೆ.",
    ],
  },

  malayalam: {
    okay: ["ശരി.", "ഓക്കെ.", "മനസ്സിലായി.", "നന്ദി.", "ഉവ്വ്."],
    noProblem: ["കുഴപ്പമില്ല, മുന്നോട്ട് പോകാം.", "ശരി, അടുത്തതിലേക്ക് പോകാം."],
    addMore: [
      "വേറെ എന്തെങ്കിലും പറയാനുണ്ടോ?",
      "ഇതിനെക്കുറിച്ച് കൂടുതൽ പറയാമോ?",
      "വേറെ എന്തെങ്കിലും ചേർക്കണോ?",
      "കുറച്ചുകൂടി പറയാമോ?",
    ],
    whatHappened: ["{name}, എല്ലാം ശരിയാണോ?", "{name}, നിങ്ങൾക്ക് കേൾക്കാമോ?"],
    didNotGet: ["ചോദ്യം മനസ്സിലായില്ലേ?", "ചോദ്യം വ്യക്തമായിരുന്നില്ലേ?"],
    goAhead: ["അതെ, പറയൂ.", "പറയൂ, ഞാൻ കേൾക്കുന്നുണ്ട്."],
    areYouOkay: [
      "{name}, സുഖമാണോ? സാവധാനം മതി.",
      "എല്ലാം ശരിയാണോ {name}? തിരക്കില്ല.",
    ],
    closing: [
      "അഭിമുഖം ഇവിടെ അവസാനിക്കുന്നു. സമയത്തിന് നന്ദി — ഞങ്ങൾ ഉടൻ ബന്ധപ്പെടും.",
    ],
  },

  odia: {
    okay: ["ଠିକ ଅଛି।", "ଆଚ୍ଛା।", "ବୁଝିଲି।", "ଧନ୍ୟବାଦ।", "ହଁ।"],
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
    whatHappened: ["{name}, ସବୁ ଠିକ ଅଛି ତ?", "{name}, ଆପଣ ଶୁଣି ପାରୁଛନ୍ତି କି?"],
    didNotGet: ["ପ୍ରଶ୍ନଟା ବୁଝି ପାରିଲେ ନାହିଁ କି?", "ପ୍ରଶ୍ନଟା ସ୍ପଷ୍ଟ ନଥିଲା କି?"],
    goAhead: ["ହଁ, କୁହନ୍ତୁ।", "କୁହନ୍ତୁ, ମୁଁ ଶୁଣୁଛି।"],
    areYouOkay: [
      "{name}, ଆପଣ ଠିକ ଅଛନ୍ତି ତ? ଧୀରେ ନିଅନ୍ତୁ।",
      "ସବୁ ଠିକ ଅଛି ତ {name}? ତରବର ନାହିଁ।",
    ],
    closing: [
      "ସାକ୍ଷାତକାର ଏଠାରେ ଶେଷ। ଆପଣଙ୍କ ସମୟ ପାଇଁ ଧନ୍ୟବାଦ — ଆମେ ଶୀଘ୍ର ଯୋଗାଯୋଗ କରିବୁ।",
    ],
  },

  punjabi: {
    okay: ["ਠੀਕ ਹੈ।", "ਅੱਛਾ।", "ਸਮਝ ਗਿਆ।", "ਧੰਨਵਾਦ।", "ਹਾਂ।"],
    noProblem: ["ਕੋਈ ਗੱਲ ਨਹੀਂ, ਅੱਗੇ ਵਧਦੇ ਹਾਂ।", "ਠੀਕ ਹੈ, ਅਗਲਾ ਸਵਾਲ ਲੈਂਦੇ ਹਾਂ।"],
    addMore: [
      "ਕੁਝ ਹੋਰ ਦੱਸਣਾ ਚਾਹੋਗੇ?",
      "ਇਸ ਬਾਰੇ ਹੋਰ ਕੁਝ ਕਹੋਗੇ?",
      "ਹੋਰ ਕੁਝ ਜੋੜਨਾ ਹੈ?",
      "ਥੋੜ੍ਹਾ ਹੋਰ ਦੱਸੋਗੇ?",
    ],
    whatHappened: ["{name}, ਸਭ ਠੀਕ ਹੈ?", "{name}, ਤੁਹਾਨੂੰ ਸੁਣ ਰਿਹਾ ਹੈ?"],
    didNotGet: ["ਕੀ ਸਵਾਲ ਸਮਝ ਨਹੀਂ ਆਇਆ?", "ਕੀ ਸਵਾਲ ਸਾਫ਼ ਨਹੀਂ ਸੀ?"],
    goAhead: ["ਹਾਂ, ਦੱਸੋ।", "ਦੱਸੋ, ਮੈਂ ਸੁਣ ਰਿਹਾ ਹਾਂ।"],
    areYouOkay: [
      "{name}, ਤੁਸੀਂ ਠੀਕ ਹੋ? ਆਰਾਮ ਨਾਲ ਲਵੋ।",
      "ਸਭ ਠੀਕ ਹੈ ਨਾ {name}? ਕੋਈ ਕਾਹਲੀ ਨਹੀਂ।",
    ],
    closing: [
      "ਇੰਟਰਵਿਊ ਇੱਥੇ ਪੂਰਾ ਹੋਇਆ। ਤੁਹਾਡੇ ਸਮੇਂ ਲਈ ਧੰਨਵਾਦ — ਅਸੀਂ ਜਲਦੀ ਸੰਪਰਕ ਕਰਾਂਗੇ।",
    ],
  },

  tamil: {
    okay: ["சரி.", "ஓகே.", "புரிஞ்சுது.", "நன்றி.", "ஆமா."],
    noProblem: ["பரவாயில்ல, அடுத்ததுக்கு போகலாம்.", "சரி, தொடர்ந்து போகலாம்."],
    addMore: [
      "வேற ஏதாவது சொல்ல விரும்புறீங்களா?",
      "இதப் பத்தி இன்னும் ஏதாவது சொல்வீங்களா?",
      "வேற ஏதாவது சேர்க்கணுமா?",
      "கொஞ்சம் அதிகமா சொல்வீங்களா?",
    ],
    whatHappened: ["{name}, எல்லாம் சரியா?", "{name}, உங்களுக்கு கேட்குதா?"],
    didNotGet: ["கேள்வி புரியலையா?", "கேள்வி தெளிவா இல்லையா?"],
    goAhead: ["ஆமா, சொல்லுங்க.", "சொல்லுங்க, நான் கேட்கிறேன்."],
    areYouOkay: [
      "{name}, நல்லா இருக்கீங்களா? நிதானமா எடுத்துக்கோங்க.",
      "எல்லாம் சரியா {name}? அவசரம் இல்ல.",
    ],
    closing: [
      "நேர்காணல் இத்தோட முடிஞ்சது. உங்க நேரத்துக்கு நன்றி — நாங்க சீக்கிரம் தொடர்பு கொள்வோம்.",
    ],
  },

  telugu: {
    okay: ["సరే.", "ఓకే.", "అర్థమైంది.", "ధన్యవాదాలు.", "అవును."],
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
    whatHappened: ["{name}, అంతా బాగుందా?", "{name}, మీకు వినిపిస్తోందా?"],
    didNotGet: ["ప్రశ్న అర్థం కాలేదా?", "ప్రశ్న స్పష్టంగా లేదా?"],
    goAhead: ["అవును, చెప్పండి.", "చెప్పండి, నేను వింటున్నాను."],
    areYouOkay: [
      "{name}, మీరు బాగున్నారా? నిదానంగా తీసుకోండి.",
      "అంతా బాగుందా {name}? తొందరేమీ లేదు.",
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
