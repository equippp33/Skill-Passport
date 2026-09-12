import type { Messages } from "./en";

/**
 * Hindi (हिंदी).
 *
 * Same plain, conversational register as the Marathi dictionary.
 *
 * NOTE FOR MAINTAINERS: not yet reviewed by a native Hindi speaker.
 */
export const hi: Messages = {
  app: {
    name: "स्किल पासपोर्ट",
    tagline: "कार्यस्थल कौशल्य मूल्यांकन",
    signOut: "साइन आउट",
    skipToContent: "मुख्य सामग्री पर जाएँ",
    back: "वापस",
  },

  login: {
    title: "साइन इन करें",
    subtitle: "अपना ईमेल और पासवर्ड इस्तेमाल करें।",
    intro: "मूल्यांकन शुरू करने के लिए साइन इन करें।",
    email: "ईमेल पता",
    password: "पासवर्ड",
    submit: "साइन इन करें",
    submitting: "साइन इन हो रहा है…",
    invalid: "ईमेल या पासवर्ड गलत है।",
    emailRequired: "अपना ईमेल पता डालें।",
    emailInvalid: "सही ईमेल पता डालें।",
    passwordRequired: "पासवर्ड कम से कम ८ अक्षरों का होना चाहिए।",
    noAccount: "नए हैं?",
    signUpLink: "खाता बनाएँ",
  },

  signup: {
    title: "खाता बनाएँ",
    subtitle: "अपना ईमेल और पासवर्ड इस्तेमाल करें।",
    intro: "मूल्यांकन शुरू करने के लिए खाता बनाएँ।",
    submit: "खाता बनाएँ",
    submitting: "खाता बन रहा है…",
    passwordHint: "कम से कम ८ अक्षर।",
    emailTaken: "इस ईमेल का खाता पहले से है। इसके बजाय साइन इन करें।",
    haveAccount: "पहले से खाता है?",
    signInLink: "साइन इन करें",
  },

  dashboard: {
    title: "मूल्यांकन",
    subtitle: "कार्यस्थल कौशल्य की मुलाकात दें और विस्तृत प्रतिक्रिया पाएँ।",
    newInterview: "नया मूल्यांकन शुरू करें",
    emptyTitle: "अभी तक कोई मूल्यांकन नहीं",
    emptyBody:
      "अपना पहला मूल्यांकन शुरू करें। इसमें दस कार्य कौशल्य जाँचे जाते हैं, एक बार में एक सवाल।",
    statusLabel: "स्थिति",
    scoreLabel: "अंक",
    questions: "सवाल",
    assessmentName: "कार्यस्थल कौशल्य मूल्यांकन",
    continue: "जारी रखें",
    viewResult: "परिणाम देखें",
    notConfiguredTitle: "मूल्यांकन कॉन्फ़िगर नहीं है",
    notConfiguredBody:
      "OPENAI_API_KEY सेट नहीं है, इसलिए नया मूल्यांकन शुरू नहीं हो सकता। आप ऐप देख सकते हैं और पुराने मूल्यांकन पढ़ सकते हैं।",
  },

  instructions: {
    title: "शुरू करने से पहले",
    expectTitle: "क्या उम्मीद करें",
    expectSubtitle:
      "एक बार में एक सवाल। सुनें, बोलकर जवाब दें, फिर अगला दबाएँ।",
    duration: "लगभग {minutes} मिनट",
    skillsCovered:
      "इसमें भरोसेमंदी, टीम वर्क और संवाद जैसे दस कार्य कौशल्य जाँचे जाते हैं।",
    answerLimit:
      "हर जवाब ज़्यादा से ज़्यादा {seconds} सेकंड का हो सकता है। सवाल पढ़े जाने के बाद रिकॉर्डिंग अपने आप शुरू हो जाती है।",
    microphone:
      "आपको चालू माइक्रोफ़ोन और शांत जगह चाहिए — आसपास शोर होने पर सटीकता घट जाती है।",
    recorded:
      "आपके जवाब रिकॉर्ड किए जाते हैं, लिखे जाते हैं और अपने आप जाँचे जाते हैं, जिससे प्रतिक्रिया और अंक बनते हैं।",
    noRetake:
      "जवाब दोबारा रिकॉर्ड नहीं हो सकता, इसलिए बोलने से पहले थोड़ा सोच लें।",
    notHiring: "यह सिर्फ़ अभ्यास है — यह नौकरी का फ़ैसला नहीं है।",
    languageNotice:
      "पूरा मूल्यांकन — सवाल, आपके जवाब और रिपोर्ट — {language} में होगा।",
    ownLanguageTitle: "आप अपनी भाषा में जवाब दे सकते हैं",
    groupHowItWorks: "यह कैसे चलता है",
    groupWhatYouNeed: "आपको क्या चाहिए",
    groupYourAnswers: "आपके जवाब",
    micCheckTitle: "माइक्रोफ़ोन जाँच",
    micCheckSubtitle: "जवाब रिकॉर्ड करने के लिए अनुमति दें।",
    micTest: "माइक्रोफ़ोन जाँचें",
    micTesting: "अनुमति माँगी जा रही है…",
    micRetest: "दोबारा जाँचें",
    micReady: "माइक्रोफ़ोन तैयार है",
    micAndCameraReady: "माइक्रोफ़ोन और कैमरा तैयार हैं",
    cameraOptional: "आप सिर्फ़ आवाज़ के साथ आगे बढ़ सकते हैं।",
    micReadyNoCamera: "माइक्रोफ़ोन तैयार है (कैमरा नहीं — सिर्फ़ आवाज़)",
    camera:
      "आपके जवाब के साथ आपका कैमरा भी रिकॉर्ड होता है। कैमरा मना करने पर मूल्यांकन सिर्फ़ आवाज़ से चलता रहेगा।",
    micUntested: "अभी तक जाँचा नहीं",
    micUnavailable: "माइक्रोफ़ोन उपलब्ध नहीं",
    consent:
      "मैं सहमत हूँ कि मेरे जवाब रिकॉर्ड, लिखे और अपने आप जाँचे जाएँ ताकि प्रतिक्रिया बन सके।",
    start: "मूल्यांकन शुरू करें",
    starting: "पहला सवाल तैयार हो रहा है…",
    needMic: "आगे बढ़ने के लिए माइक्रोफ़ोन जाँचें।",
    needConsent: "आगे बढ़ने के लिए सहमति बॉक्स चुनें।",
    notConfiguredTitle: "मूल्यांकन कॉन्फ़िगर नहीं है",
    notConfiguredBody:
      "OPENAI_API_KEY सेट नहीं है, इसलिए पहला सवाल तैयार नहीं हो सकता।",
  },

  interview: {
    questionProgress: "सवाल {current} / {total}",
    assessing: "जाँचा जा रहा कौशल्य: {skill}",
    playQuestion: "सवाल सुनें",
    audioUnavailable: "इस सवाल की आवाज़ उपलब्ध नहीं है।",
    retryAudio: "आवाज़ दोबारा बनाएँ",
    generatingAudio: "बन रहा है…",
    audioFailed: "आवाज़ नहीं चल पाई — आप ऊपर सवाल पढ़ सकते हैं।",
    ready: "रिकॉर्ड करने के लिए तैयार",
    recording: "रिकॉर्डिंग चल रही है",
    recorded: "रिकॉर्ड हो गया",
    uploading: "अपलोड हो रहा है…",
    processingStatus: "आपका जवाब जाँचा जा रहा है…",
    startRecording: "रिकॉर्डिंग शुरू करें",
    stopRecording: "रिकॉर्डिंग रोकें",
    submitAnswer: "जवाब भेजें",
    submitting: "भेजा जा रहा है…",
    reRecord: "दोबारा रिकॉर्ड करें",
    next: "अगला सवाल",
    finish: "मूल्यांकन पूरा करें",
    keepSpeaking: "बोलते रहिए — आपके रुकते ही यह अपने आप आगे बढ़ जाएगा।",
    advancingIn: "{seconds} में आगे बढ़ रहे हैं…",
    introduction: "परिचय",
    chooseLanguageTitle: "आप किस भाषा में आगे बढ़ना चाहेंगे?",
    chooseLanguageBody:
      "उस जवाब से आपकी भाषा पहचानी नहीं जा सकी। एक चुनें, बाकी इंटरव्यू उसी में होगा।",
    languageLabel: "भाषा",
    languageHint: "मौजूदा सवाल दोबारा पूछा जाएगा",
    liveCaptions: "लाइव कैप्शन",
    listening: "सुन रहे हैं…",
    preparing: "तैयारी हो रही है…",
    tooShort: "यह जवाब बहुत छोटा था। कृपया दोबारा जवाब दें।",
    greeting:
      "नमस्ते, आपका स्वागत है। मैं आपसे काम करने के तरीके पर कुछ सवाल पूछूँगा। सहज होकर जवाब दें — इसमें कुछ मुश्किल नहीं है।",
    savingRecordings: "आपकी रिकॉर्डिंग सहेजी जा रही है — बस हो गया…",
    processingHint:
      "आपका जवाब लिखा और जाँचा जा रहा है। इसमें कुछ सेकंड लगते हैं — यह पेज खुला रखें।",
    errorTitle: "कुछ गड़बड़ हो गई",
    micProblemTitle: "माइक्रोफ़ोन में दिक्कत",
    recordAgain: "दोबारा रिकॉर्ड करें",
    unavailableTitle: "मूल्यांकन उपलब्ध नहीं",
    unavailableBody:
      "इस मूल्यांकन में अभी कोई सवाल नहीं है। वापस जाकर दोबारा कोशिश करें।",
    leaveWarning: "इस पेज से हटने पर आपकी रिकॉर्डिंग चली जाएगी।",
  },

  result: {
    title: "मूल्यांकन का परिणाम",
    completedOn: "{date} को पूरा हुआ",
    overallScore: "कुल अंक",
    answered: "{total} में से {answered} सवालों के जवाब दिए",
    summary: "सारांश",
    strengths: "मज़बूत पक्ष",
    improvements: "सुधार के क्षेत्र",
    noStrengths: "कोई खास मज़बूत पक्ष नहीं मिला।",
    noImprovements: "कोई खास सुधार नहीं सुझाया गया।",
    skillBreakdown: "कौशल्यवार अंक",
    skillBreakdownHint: "सभी दस कार्य कौशल्य, हर एक १० में से।",
    notAssessed: "जाँचा नहीं गया",
    questionBreakdown: "सवालवार विवरण",
    yourAnswer: "आपका जवाब",
    evaluation: "मूल्यांकन",
    noAnswers: "इस मूल्यांकन में कोई जवाब दर्ज नहीं हुआ।",
    startAnother: "एक और मूल्यांकन शुरू करें",
    allInterviews: "सभी मूल्यांकन",
  },

  status: {
    not_started: "शुरू नहीं हुआ",
    in_progress: "चल रहा है",
    processing: "जाँचा जा रहा है",
    completed: "पूरा हुआ",
    failed: "असफल",
  },

  skills: {
    reliability: "भरोसेमंदी",
    responsibility: "ज़िम्मेदारी",
    following_instructions: "निर्देशों का पालन",
    attention_to_detail: "बारीकियों पर ध्यान",
    communication: "संवाद",
    teamwork: "टीम वर्क",
    problem_solving: "सोच और समस्या समाधान",
    learning_adaptability: "सीखना और ढलना",
    initiative: "पहल",
    customer_orientation: "ग्राहक के प्रति रवैया",
  },

  errors: {
    notFoundTitle: "मूल्यांकन नहीं मिला",
    notFoundBody: "यह मूल्यांकन मौजूद नहीं है, या किसी और खाते का है।",
    reopenLink: "आपको भेजा गया इंटरव्यू लिंक दोबारा खोलें।",
    backToList: "मूल्यांकनों पर वापस जाएँ",
    generic: "कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।",
    loading: "लोड हो रहा है",
  },
};
