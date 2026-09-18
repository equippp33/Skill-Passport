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
 *
 *   Every variant is a neutral backchannel — no "yes", no "thank you", no "I
 *   understood". It is said before a word of the answer has been transcribed,
 *   so it cannot agree with, thank, or claim to have followed anything: a
 *   candidate who says "I don't know" and hears "हाँ" back has been agreed
 *   with about nothing, which is exactly when the interviewer stops sounding
 *   like a person.
 * - `whatHappened`, `didNotGet` and `noProblem` are the rungs of the silence
 *   ladder. The first tells the candidate, by name, that there is no hurry.
 *   The second offers to put the question more simply. The third stops
 *   waiting.
 *
 *   `didNotGet` is worded as an offer rather than a question — "if that was
 *   not clear, say so and I will put it more simply" — for two reasons. It is
 *   kinder: "did you not follow the question?" lands on somebody already
 *   struggling as an accusation. And it is answerable with the words the
 *   phrase list already knows, so "I didn't understand" routes straight to the
 *   simpler wording, where a bare "yes" to a yes-or-no question would not.
 * - `addMore` is asked once when an answer was a word or two — the difference
 *   between a candidate who has finished and one who has not started — and
 *   `goAhead` is the reply when they say yes, they do have more.
 * - `stayOnTopic` answers a question put to the interviewer rather than an
 *   answer to it — "what is your name?", "just tell me the answer". Warm, and
 *   it asks for the answer again rather than telling anybody off.
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
 * Warmth is the whole brief for the wording. Everything here is said to
 * somebody who has gone quiet, coughed, or given a one-line answer — a
 * candidate at their least comfortable — and a line that is merely efficient
 * reads at that moment as impatience. "Take your time, there is no hurry"
 * costs the same second as "are you still with me?" and does the opposite to
 * whoever hears it.
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
  | "stayOnTopic"
  | "closing";

type FillerSet = Record<FillerKind, string[]>;

export const FILLERS: Record<InterviewLanguageKey, FillerSet> = {
  english: {
    okay: ["Okay.", "Alright.", "I see.", "Mm-hmm.", "Right."],
    whatHappened: [
      "Take your time, {name}, there is no hurry at all.",
      "{name}, I am right here whenever you are ready.",
    ],
    didNotGet: [
      "If that question was not clear, just say so and I will put it more simply.",
      "Say the word if you would like me to ask that in an easier way.",
    ],
    noProblem: [
      "That is completely fine, let us carry on.",
      "No trouble at all, we will move on.",
    ],
    addMore: [
      "Would you like to add anything?",
      "Anything else you would like to say about that?",
      "Is there more you would like to tell me?",
      "Would you like to say a little more?",
    ],
    goAhead: ["Of course, please go ahead.", "Yes, I am listening."],
    areYouOkay: [
      "Take your time, {name}, there is no rush.",
      "{name}, are you okay? Take a moment.",
    ],
    stayOnTopic: [
      "Let us stay with the interview, {name}. Could you answer the question for me?",
      "I cannot help with that one, {name}, but I would like to hear your answer to the question.",
    ],
    closing: [
      "That is the end of the interview. Thank you so much for your time, we will get back to you soon.",
    ],
  },

  hindi: {
    okay: ["ठीक है।", "अच्छा।", "हम्म।", "ठीक।", "अच्छा, ठीक।"],
    whatHappened: [
      "आराम से सोचिए {name}, कोई जल्दी नहीं है।",
      "{name}, जब तैयार हों तब बताइए, मैं यहीं हूँ।",
    ],
    didNotGet: [
      "अगर सवाल साफ़ न लगा हो तो बता दीजिए, मैं आसान शब्दों में पूछ दूँगा।",
      "कहिए तो सवाल थोड़ा और आसान करके पूछूँ।",
    ],
    noProblem: [
      "कोई बात नहीं, आगे बढ़ते हैं।",
      "बिल्कुल ठीक है, अगला सवाल लेते हैं।",
    ],
    addMore: [
      "कुछ और जोड़ना चाहेंगे?",
      "इसके बारे में और कुछ कहना है?",
      "कुछ और बताना चाहेंगे?",
      "थोड़ा और कहना चाहेंगे?",
    ],
    goAhead: ["जी बिल्कुल, बताइए।", "हाँ, मैं सुन रहा हूँ।"],
    areYouOkay: [
      "आराम से लीजिए {name}, कोई जल्दी नहीं।",
      "{name}, सब ठीक है? थोड़ा समय ले लीजिए।",
    ],
    stayOnTopic: [
      "हम interview पर ही रहते हैं {name}. आप सवाल का जवाब दीजिए।",
      "उसमें मैं मदद नहीं कर पाऊंगा {name}, पर आपका जवाब सुनना चाहूंगा।",
    ],
    closing: [
      "इंटरव्यू यहीं पूरा हुआ। आपके समय के लिए बहुत धन्यवाद, हम जल्दी ही आपसे संपर्क करेंगे।",
    ],
  },

  marathi: {
    okay: ["ठीक आहे.", "बरं.", "हम्म.", "ठीक.", "बरं, ठीक आहे."],
    whatHappened: [
      "आरामात विचार करा {name}, काहीच घाई नाही.",
      "{name}, तयार असाल तेव्हा सांगा, मी इथेच आहे.",
    ],
    didNotGet: [
      "प्रश्न स्पष्ट वाटला नसेल तर सांगा, मी सोप्या शब्दांत विचारतो.",
      "सांगा तर प्रश्न आणखी सोपा करून विचारू.",
    ],
    noProblem: [
      "काही हरकत नाही, पुढे जाऊया.",
      "अगदी ठीक आहे, पुढचा प्रश्न घेऊया.",
    ],
    addMore: [
      "आणखी काही सांगायचं आहे का?",
      "याबद्दल आणखी काही सांगाल का?",
      "अजून काही जोडायचं आहे का?",
      "थोडं आणखी सांगाल का?",
    ],
    goAhead: ["हो नक्कीच, सांगा.", "हो, मी ऐकतोय."],
    areYouOkay: [
      "आरामात घ्या {name}, काही घाई नाही.",
      "{name}, सगळं ठीक आहे ना? थोडा वेळ घ्या.",
    ],
    stayOnTopic: [
      "आपण interview वरच राहूया {name}. तुम्ही प्रश्नाचं उत्तर द्या.",
      "त्यात मी मदत करू शकणार नाही {name}, पण तुमचं उत्तर ऐकायला आवडेल.",
    ],
    closing: [
      "इंटरव्यू इथेच पूर्ण झाला. तुमच्या वेळेबद्दल खूप धन्यवाद, आम्ही लवकरच तुमच्याशी संपर्क साधू.",
    ],
  },

  bengali: {
    okay: ["ঠিক আছে।", "আচ্ছা।", "হুম।", "ঠিক।", "আচ্ছা, ঠিক আছে।"],
    whatHappened: [
      "ধীরে সুস্থে ভাবুন {name}, কোনো তাড়া নেই।",
      "{name}, তৈরি হলে বলবেন, আমি এখানেই আছি।",
    ],
    didNotGet: [
      "প্রশ্নটা পরিষ্কার না লাগলে বলবেন, আমি সহজ করে বলে দেব।",
      "বললে প্রশ্নটা আরও সহজ করে জিজ্ঞেস করি।",
    ],
    noProblem: ["কোনো অসুবিধা নেই, এগিয়ে যাই।", "একদম ঠিক আছে, পরেরটায় যাই।"],
    addMore: [
      "আর কিছু যোগ করতে চান?",
      "এ বিষয়ে আর কিছু বলবেন?",
      "আরও কিছু বলার আছে?",
      "আর একটু বলবেন?",
    ],
    goAhead: ["হ্যাঁ অবশ্যই, বলুন।", "হ্যাঁ, আমি শুনছি।"],
    areYouOkay: [
      "ধীরে সুস্থে নিন {name}, তাড়া নেই।",
      "{name}, সব ঠিক আছে তো? একটু সময় নিন।",
    ],
    stayOnTopic: [
      "আমরা interview-এই থাকি {name}। আপনি প্রশ্নের উত্তর দিন।",
      "ওটায় আমি সাহায্য করতে পারব না {name}, তবে আপনার উত্তরটা শুনতে চাই।",
    ],
    closing: [
      "ইন্টারভিউ এখানেই শেষ। আপনার সময়ের জন্য অনেক ধন্যবাদ, আমরা শীঘ্রই যোগাযোগ করব।",
    ],
  },

  gujarati: {
    okay: ["ઠીક છે.", "સારું.", "હમ્મ.", "ઠીક.", "સારું, ઠીક છે."],
    whatHappened: [
      "આરામથી વિચારો {name}, કોઈ ઉતાવળ નથી.",
      "{name}, તૈયાર હો ત્યારે કહો, હું અહીં જ છું.",
    ],
    didNotGet: [
      "પ્રશ્ન સ્પષ્ટ ન લાગ્યો હોય તો કહો, હું સરળ શબ્દોમાં પૂછીશ.",
      "કહો તો પ્રશ્ન થોડો વધુ સરળ કરીને પૂછું.",
    ],
    noProblem: ["કોઈ વાંધો નથી, આગળ વધીએ.", "એકદમ બરાબર, આગળનો પ્રશ્ન લઈએ."],
    addMore: [
      "કંઈ ઉમેરવું છે?",
      "આ વિશે બીજું કંઈ કહેશો?",
      "બીજું કંઈ કહેવું છે?",
      "થોડું વધારે કહેશો?",
    ],
    goAhead: ["હા જરૂર, કહો.", "હા, હું સાંભળું છું."],
    areYouOkay: [
      "આરામથી લો {name}, ઉતાવળ નથી.",
      "{name}, બધું બરાબર છે? થોડો સમય લો.",
    ],
    stayOnTopic: [
      "આપણે interview પર જ રહીએ {name}. તમે પ્રશ્નનો જવાબ આપો.",
      "એમાં હું મદદ નહીં કરી શકું {name}, પણ તમારો જવાબ સાંભળવો છે.",
    ],
    closing: [
      "ઇન્ટરવ્યૂ અહીં પૂરો થયો. તમારા સમય માટે ખૂબ આભાર, અમે જલદી સંપર્ક કરીશું.",
    ],
  },

  kannada: {
    okay: ["ಸರಿ.", "ಆಯ್ತು.", "ಹ್ಮ್.", "ಸರಿ ಸರಿ.", "ಆಯ್ತು, ಸರಿ."],
    whatHappened: [
      "ನಿಧಾನವಾಗಿ ಯೋಚಿಸಿ {name}, ಯಾವುದೇ ಅವಸರವಿಲ್ಲ.",
      "{name}, ಸಿದ್ಧವಾದಾಗ ಹೇಳಿ, ನಾನು ಇಲ್ಲೇ ಇದ್ದೀನಿ.",
    ],
    didNotGet: [
      "ಪ್ರಶ್ನೆ ಸ್ಪಷ್ಟವಾಗಿ ಅನಿಸದಿದ್ದರೆ ಹೇಳಿ, ನಾನು ಸುಲಭವಾಗಿ ಕೇಳ್ತೀನಿ.",
      "ಹೇಳಿದರೆ ಪ್ರಶ್ನೆಯನ್ನು ಇನ್ನೂ ಸುಲಭ ಮಾಡಿ ಕೇಳ್ತೀನಿ.",
    ],
    noProblem: ["ಪರವಾಗಿಲ್ಲ, ಮುಂದೆ ಹೋಗೋಣ.", "ಸರಿ, ಮುಂದಿನ ಪ್ರಶ್ನೆಗೆ ಹೋಗೋಣ."],
    addMore: [
      "ಇನ್ನೇನಾದರೂ ಸೇರಿಸಬೇಕಾ?",
      "ಇದರ ಬಗ್ಗೆ ಇನ್ನೇನಾದರೂ ಹೇಳ್ತೀರಾ?",
      "ಬೇರೇನಾದರೂ ಹೇಳೋದಿದೆಯಾ?",
      "ಸ್ವಲ್ಪ ಹೆಚ್ಚು ಹೇಳ್ತೀರಾ?",
    ],
    goAhead: ["ಹೌದು ಖಂಡಿತ, ಹೇಳಿ.", "ಹೌದು, ನಾನು ಕೇಳ್ತಾ ಇದ್ದೀನಿ."],
    areYouOkay: [
      "ನಿಧಾನವಾಗಿ ತಗೊಳ್ಳಿ {name}, ಅವಸರವಿಲ್ಲ.",
      "{name}, ಎಲ್ಲಾ ಸರಿ ಇದೆಯಾ? ಸ್ವಲ್ಪ ಸಮಯ ತಗೊಳ್ಳಿ.",
    ],
    stayOnTopic: [
      "ನಾವು interview ಮೇಲೆಯೇ ಇರೋಣ {name}. ನೀವು ಪ್ರಶ್ನೆಗೆ ಉತ್ತರಿಸಿ.",
      "ಅದಕ್ಕೆ ನಾನು ಸಹಾಯ ಮಾಡಲಾರೆ {name}, ಆದರೆ ನಿಮ್ಮ ಉತ್ತರ ಕೇಳಬೇಕು.",
    ],
    closing: [
      "ಸಂದರ್ಶನ ಇಲ್ಲಿಗೆ ಮುಗಿಯಿತು. ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ತುಂಬಾ ಧನ್ಯವಾದ, ನಾವು ಬೇಗನೆ ಸಂಪರ್ಕಿಸುತ್ತೇವೆ.",
    ],
  },

  malayalam: {
    okay: ["ശരി.", "ആയിക്കോട്ടെ.", "ഉം.", "ശരി ശരി.", "ഓക്കെ."],
    whatHappened: [
      "സാവധാനം ആലോചിക്കൂ {name}, ഒട്ടും ധൃതിയില്ല.",
      "{name}, തയ്യാറാകുമ്പോൾ പറഞ്ഞാൽ മതി, ഞാൻ ഇവിടെയുണ്ട്.",
    ],
    didNotGet: [
      "ചോദ്യം വ്യക്തമായില്ലെങ്കിൽ പറയൂ, ഞാൻ എളുപ്പത്തിൽ ചോദിക്കാം.",
      "പറഞ്ഞാൽ ചോദ്യം കുറച്ചുകൂടി എളുപ്പമാക്കി ചോദിക്കാം.",
    ],
    noProblem: [
      "കുഴപ്പമില്ല, നമുക്ക് മുന്നോട്ട് പോകാം.",
      "സാരമില്ല, അടുത്ത ചോദ്യത്തിലേക്ക് പോകാം.",
    ],
    addMore: [
      "വേറെ എന്തെങ്കിലും ചേർക്കാനുണ്ടോ?",
      "ഇതിനെക്കുറിച്ച് വേറെ എന്തെങ്കിലും പറയാനുണ്ടോ?",
      "കൂടുതൽ എന്തെങ്കിലും പറയാനുണ്ടോ?",
      "കുറച്ചുകൂടി പറയാമോ?",
    ],
    goAhead: ["തീർച്ചയായും, പറയൂ.", "അതെ, ഞാൻ കേൾക്കുന്നുണ്ട്."],
    areYouOkay: [
      "സാവധാനം മതി {name}, ധൃതിയില്ല.",
      "{name}, സുഖമാണോ? ഒരു നിമിഷം എടുത്തോളൂ.",
    ],
    stayOnTopic: [
      "നമുക്ക് interview-ൽ തന്നെ നിൽക്കാം {name}. നിങ്ങൾ ചോദ്യത്തിന് ഉത്തരം പറയൂ.",
      "അതിൽ എനിക്ക് സഹായിക്കാനാകില്ല {name}, പക്ഷേ നിങ്ങളുടെ ഉത്തരം കേൾക്കണം.",
    ],
    closing: [
      "അഭിമുഖം ഇവിടെ അവസാനിക്കുന്നു. നിങ്ങളുടെ സമയത്തിന് ഒരുപാട് നന്ദി, ഞങ്ങൾ ഉടൻ ബന്ധപ്പെടും.",
    ],
  },

  odia: {
    okay: ["ଠିକ ଅଛି।", "ଆଚ୍ଛା।", "ହମ୍।", "ଠିକ।", "ଆଚ୍ଛା, ଠିକ ଅଛି।"],
    whatHappened: [
      "ଧୀରେ ଭାବନ୍ତୁ {name}, କୌଣସି ତରବର ନାହିଁ।",
      "{name}, ପ୍ରସ୍ତୁତ ହେଲେ କୁହନ୍ତୁ, ମୁଁ ଏଠି ଅଛି।",
    ],
    didNotGet: [
      "ପ୍ରଶ୍ନଟା ସ୍ପଷ୍ଟ ନ ଲାଗିଲେ କୁହନ୍ତୁ, ମୁଁ ସହଜ କରି ପଚାରିବି।",
      "କହିଲେ ପ୍ରଶ୍ନଟାକୁ ଆଉ ସହଜ କରି ପଚାରିବି।",
    ],
    noProblem: [
      "କିଛି ଅସୁବିଧା ନାହିଁ, ଆଗକୁ ଯିବା।",
      "ଠିକ ଅଛି, ପରବର୍ତ୍ତୀ ପ୍ରଶ୍ନକୁ ଯିବା।",
    ],
    addMore: [
      "ଆଉ କିଛି ଯୋଡ଼ିବାକୁ ଚାହାଁନ୍ତି କି?",
      "ଏ ବିଷୟରେ ଆଉ କିଛି କହିବେ କି?",
      "ଆଉ କିଛି କହିବାର ଅଛି କି?",
      "ଟିକେ ଅଧିକ କହିବେ କି?",
    ],
    goAhead: ["ହଁ ନିଶ୍ଚୟ, କୁହନ୍ତୁ।", "ହଁ, ମୁଁ ଶୁଣୁଛି।"],
    areYouOkay: [
      "ଧୀରେ ନିଅନ୍ତୁ {name}, ତରବର ନାହିଁ।",
      "{name}, ସବୁ ଠିକ ଅଛି ତ? ଟିକେ ସମୟ ନିଅନ୍ତୁ।",
    ],
    stayOnTopic: [
      "ଆମେ interview ରେ ହିଁ ରହିବା {name}. ଆପଣ ପ୍ରଶ୍ନର ଉତ୍ତର ଦିଅନ୍ତୁ।",
      "ସେଥିରେ ମୁଁ ସାହାଯ୍ୟ କରିପାରିବି ନାହିଁ {name}, କିନ୍ତୁ ଆପଣଙ୍କ ଉତ୍ତର ଶୁଣିବାକୁ ଚାହେଁ।",
    ],
    closing: [
      "ସାକ୍ଷାତକାର ଏଠାରେ ସମାପ୍ତ। ଆପଣଙ୍କ ସମୟ ପାଇଁ ବହୁତ ଧନ୍ୟବାଦ, ଆମେ ଶୀଘ୍ର ଯୋଗାଯୋଗ କରିବୁ।",
    ],
  },

  punjabi: {
    okay: ["ਠੀਕ ਹੈ।", "ਅੱਛਾ।", "ਹਮਮ।", "ਠੀਕ।", "ਅੱਛਾ, ਠੀਕ ਹੈ।"],
    whatHappened: [
      "ਆਰਾਮ ਨਾਲ ਸੋਚੋ {name}, ਕੋਈ ਕਾਹਲੀ ਨਹੀਂ।",
      "{name}, ਜਦੋਂ ਤਿਆਰ ਹੋਵੋ ਦੱਸ ਦੇਣਾ, ਮੈਂ ਇੱਥੇ ਹੀ ਹਾਂ।",
    ],
    didNotGet: [
      "ਜੇ ਸਵਾਲ ਸਾਫ਼ ਨਹੀਂ ਲੱਗਿਆ ਤਾਂ ਦੱਸ ਦਿਓ, ਮੈਂ ਸੌਖੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਪੁੱਛ ਦਿਆਂਗਾ।",
      "ਕਹੋ ਤਾਂ ਸਵਾਲ ਥੋੜਾ ਹੋਰ ਸੌਖਾ ਕਰਕੇ ਪੁੱਛਾਂ।",
    ],
    noProblem: [
      "ਕੋਈ ਗੱਲ ਨਹੀਂ, ਅੱਗੇ ਵਧਦੇ ਹਾਂ।",
      "ਬਿਲਕੁਲ ਠੀਕ ਹੈ, ਅਗਲਾ ਸਵਾਲ ਲੈਂਦੇ ਹਾਂ।",
    ],
    addMore: [
      "ਕੁਝ ਹੋਰ ਜੋੜਨਾ ਚਾਹੋਗੇ?",
      "ਇਸ ਬਾਰੇ ਹੋਰ ਕੁਝ ਕਹਿਣਾ ਹੈ?",
      "ਹੋਰ ਕੁਝ ਦੱਸਣਾ ਚਾਹੋਗੇ?",
      "ਥੋੜਾ ਹੋਰ ਕਹੋਗੇ?",
    ],
    goAhead: ["ਹਾਂ ਜ਼ਰੂਰ, ਦੱਸੋ।", "ਹਾਂ, ਮੈਂ ਸੁਣ ਰਿਹਾ ਹਾਂ।"],
    areYouOkay: [
      "ਆਰਾਮ ਨਾਲ ਲਵੋ {name}, ਕਾਹਲੀ ਨਹੀਂ।",
      "{name}, ਸਭ ਠੀਕ ਹੈ? ਥੋੜਾ ਸਮਾਂ ਲੈ ਲਵੋ।",
    ],
    stayOnTopic: [
      "ਅਸੀਂ interview ਉੱਤੇ ਹੀ ਰਹਿੰਦੇ ਹਾਂ {name}। ਤੁਸੀਂ ਸਵਾਲ ਦਾ ਜਵਾਬ ਦਿਓ।",
      "ਉਸ ਵਿੱਚ ਮੈਂ ਮਦਦ ਨਹੀਂ ਕਰ ਸਕਾਂਗਾ {name}, ਪਰ ਤੁਹਾਡਾ ਜਵਾਬ ਸੁਣਨਾ ਚਾਹਾਂਗਾ।",
    ],
    closing: [
      "ਇੰਟਰਵਿਊ ਇੱਥੇ ਪੂਰਾ ਹੋਇਆ। ਤੁਹਾਡੇ ਸਮੇਂ ਲਈ ਬਹੁਤ ਧੰਨਵਾਦ, ਅਸੀਂ ਜਲਦੀ ਸੰਪਰਕ ਕਰਾਂਗੇ।",
    ],
  },

  tamil: {
    okay: ["சரி.", "ஆச்சு.", "ம்ம்.", "சரி சரி.", "ஓகே."],
    whatHappened: [
      "நிதானமா யோசிங்க {name}, எந்த அவசரமும் இல்ல.",
      "{name}, தயாரா இருக்கும்போது சொல்லுங்க, நான் இங்கதான் இருக்கேன்.",
    ],
    didNotGet: [
      "கேள்வி தெளிவா இல்லைன்னா சொல்லுங்க, நான் சுலபமா கேட்கிறேன்.",
      "சொன்னா கேள்விய இன்னும் கொஞ்சம் சுலபமா கேட்கிறேன்.",
    ],
    noProblem: [
      "பரவாயில்ல, அடுத்ததுக்கு போகலாம்.",
      "சரி, அடுத்த கேள்விக்கு போகலாம்.",
    ],
    addMore: [
      "வேற ஏதாவது சேர்க்கணுமா?",
      "இத பத்தி வேற ஏதாவது சொல்றீங்களா?",
      "இன்னும் ஏதாவது சொல்லணுமா?",
      "கொஞ்சம் அதிகமா சொல்றீங்களா?",
    ],
    goAhead: ["ஆமா கண்டிப்பா, சொல்லுங்க.", "ஆமா, நான் கேட்கிறேன்."],
    areYouOkay: [
      "நிதானமா எடுத்துக்கோங்க {name}, அவசரம் இல்ல.",
      "{name}, நல்லா இருக்கீங்களா? கொஞ்சம் நேரம் எடுத்துக்கோங்க.",
    ],
    stayOnTopic: [
      "நாம interview-லயே இருக்கலாம் {name}. நீங்க கேள்விக்கு பதில் சொல்லுங்க.",
      "அதுல நான் உதவ முடியாது {name}, ஆனா உங்க பதில கேட்கணும்.",
    ],
    closing: [
      "இண்டர்வியூ இத்தோட முடிஞ்சுது. உங்க நேரத்துக்கு ரொம்ப நன்றி, நாங்க சீக்கிரம் தொடர்பு கொள்வோம்.",
    ],
  },

  telugu: {
    okay: ["సరే.", "అలాగే.", "హ్మ్.", "సరే సరే.", "ఓకే."],
    whatHappened: [
      "నిదానంగా ఆలోచించండి {name}, ఏమీ తొందర లేదు.",
      "{name}, సిద్ధంగా ఉన్నప్పుడు చెప్పండి, నేను ఇక్కడే ఉన్నాను.",
    ],
    didNotGet: [
      "ప్రశ్న స్పష్టంగా అనిపించకపోతే చెప్పండి, నేను సులభంగా అడుగుతాను.",
      "చెబితే ప్రశ్నను ఇంకా సులభం చేసి అడుగుతాను.",
    ],
    noProblem: [
      "పర్వాలేదు, ముందుకు వెళ్దాం.",
      "సరే, తర్వాతి ప్రశ్నకు వెళ్దాం.",
    ],
    addMore: [
      "ఇంకేమైనా చేర్చాలనుకుంటున్నారా?",
      "దీని గురించి ఇంకేమైనా చెబుతారా?",
      "ఇంకేమైనా చెప్పాలనుకుంటున్నారా?",
      "కొంచెం ఎక్కువ చెబుతారా?",
    ],
    goAhead: ["అవును తప్పకుండా, చెప్పండి.", "అవును, నేను వింటున్నాను."],
    areYouOkay: [
      "నిదానంగా తీసుకోండి {name}, తొందరేమీ లేదు.",
      "{name}, మీరు బాగున్నారా? కొంచెం సమయం తీసుకోండి.",
    ],
    stayOnTopic: [
      "మనం interview మీదే ఉందాం {name}. మీరు ప్రశ్నకు సమాధానం చెప్పండి.",
      "దాంట్లో నేను సాయం చేయలేను {name}, కానీ మీ సమాధానం వినాలి.",
    ],
    closing: [
      "ఇంటర్వ్యూ ఇక్కడితో పూర్తయింది. మీ సమయానికి చాలా ధన్యవాదాలు, మేము త్వరలో సంప్రదిస్తాము.",
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
