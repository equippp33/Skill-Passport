import type { Messages } from "./en";

/**
 * Marathi (मराठी).
 *
 * Written for candidates who may not be fluent in English, so the register is
 * deliberately plain and conversational rather than formal/literary.
 *
 * NOTE FOR MAINTAINERS: these strings were produced during implementation and
 * have not been reviewed by a native Marathi speaker. Have them proofread
 * before this goes in front of real candidates.
 */
export const mr: Messages = {
  app: {
    name: "स्किल पासपोर्ट",
    tagline: "कामाच्या कौशल्यांचे मूल्यांकन",
    signOut: "साइन आउट",
    skipToContent: "मजकुराकडे जा",
    back: "मागे",
  },

  login: {
    title: "साइन इन करा",
    subtitle: "तुमचा ईमेल आणि पासवर्ड वापरा.",
    intro: "मूल्यांकन सुरू करण्यासाठी साइन इन करा.",
    email: "ईमेल पत्ता",
    password: "पासवर्ड",
    submit: "साइन इन करा",
    submitting: "साइन इन होत आहे…",
    invalid: "ईमेल किंवा पासवर्ड चुकीचा आहे.",
    emailRequired: "तुमचा ईमेल पत्ता टाका.",
    emailInvalid: "वैध ईमेल पत्ता टाका.",
    passwordRequired: "पासवर्ड किमान ८ अक्षरांचा असावा.",
    noAccount: "नवीन आहात?",
    signUpLink: "खाते तयार करा",
  },

  signup: {
    title: "खाते तयार करा",
    subtitle: "तुमचा ईमेल आणि पासवर्ड वापरा.",
    intro: "मूल्यांकन सुरू करण्यासाठी खाते तयार करा.",
    submit: "खाते तयार करा",
    submitting: "खाते तयार होत आहे…",
    passwordHint: "किमान ८ अक्षरे.",
    emailTaken: "या ईमेलचे खाते आधीच आहे. त्याऐवजी साइन इन करा.",
    haveAccount: "आधीच खाते आहे?",
    signInLink: "साइन इन करा",
  },

  dashboard: {
    title: "मूल्यांकने",
    subtitle: "कामाच्या कौशल्यांची मुलाखत द्या आणि सविस्तर अभिप्राय मिळवा.",
    newInterview: "नवीन मूल्यांकन सुरू करा",
    emptyTitle: "अजून एकही मूल्यांकन नाही",
    emptyBody:
      "तुमचे पहिले मूल्यांकन सुरू करा. यात दहा कामाची कौशल्ये तपासली जातात, एका वेळी एक प्रश्न.",
    statusLabel: "स्थिती",
    scoreLabel: "गुण",
    questions: "प्रश्न",
    assessmentName: "कामाच्या कौशल्यांचे मूल्यांकन",
    continue: "पुढे चालू ठेवा",
    viewResult: "निकाल पहा",
    notConfiguredTitle: "मूल्यांकनाची तयारी झालेली नाही",
    notConfiguredBody:
      "OPENAI_API_KEY सेट केलेली नाही, त्यामुळे नवीन मूल्यांकन सुरू करता येणार नाही. तुम्ही ॲप पाहू शकता आणि जुनी मूल्यांकने तपासू शकता.",
  },

  instructions: {
    title: "सुरू करण्यापूर्वी",
    expectTitle: "काय अपेक्षित आहे",
    expectSubtitle:
      "एका वेळी एक प्रश्न. ऐका, मोठ्याने उत्तर द्या आणि मग पुढील बटण दाबा.",
    duration: "साधारण {minutes} मिनिटे",
    skillsCovered:
      "यात विश्वासार्हता, सांघिक काम आणि संवाद अशी दहा कामाची कौशल्ये तपासली जातात.",
    answerLimit:
      "प्रत्येक उत्तर जास्तीत जास्त {seconds} सेकंदांचे असू शकते. प्रश्न वाचून झाल्यावर रेकॉर्डिंग आपोआप सुरू होते.",
    microphone:
      "तुम्हाला चालू मायक्रोफोन आणि शांत जागा लागेल — आजूबाजूचा आवाज असल्यास अचूकता कमी होते.",
    recorded:
      "तुमची उत्तरे रेकॉर्ड केली जातात, लिहून घेतली जातात आणि आपोआप तपासली जातात, त्यातून अभिप्राय व गुण तयार होतात.",
    noRetake:
      "उत्तर पुन्हा रेकॉर्ड करता येत नाही, त्यामुळे बोलण्यापूर्वी थोडा विचार करा.",
    notHiring: "हा फक्त सराव आहे — हा नोकरीचा निर्णय नाही.",
    languageNotice:
      "संपूर्ण मूल्यांकन — प्रश्न, तुमची उत्तरे आणि अहवाल — {language} भाषेत असेल.",
    ownLanguageTitle: "तुम्ही तुमच्या भाषेत उत्तर देऊ शकता",
    groupHowItWorks: "हे कसे चालते",
    groupWhatYouNeed: "तुम्हाला काय लागेल",
    groupYourAnswers: "तुमची उत्तरे",
    micCheckTitle: "मायक्रोफोन तपासणी",
    micCheckSubtitle: "उत्तरे रेकॉर्ड करता यावीत म्हणून परवानगी द्या.",
    micTest: "मायक्रोफोन तपासा",
    micTesting: "परवानगी मागत आहे…",
    micRetest: "पुन्हा तपासा",
    micReady: "मायक्रोफोन तयार आहे",
    micAndCameraReady: "मायक्रोफोन आणि कॅमेरा तयार आहेत",
    cameraOptional: "तुम्ही फक्त आवाजासह पुढे जाऊ शकता.",
    micReadyNoCamera: "मायक्रोफोन तयार आहे (कॅमेरा नाही — फक्त आवाज)",
    camera:
      "तुमच्या उत्तरासोबत तुमचा कॅमेराही रेकॉर्ड केला जातो. कॅमेरा नाकारल्यास मूल्यांकन फक्त आवाजाने चालू राहते.",
    micUntested: "अजून तपासलेला नाही",
    micUnavailable: "मायक्रोफोन उपलब्ध नाही",
    consent:
      "माझी उत्तरे रेकॉर्ड करून, लिहून घेऊन आणि आपोआप तपासून अभिप्राय तयार करण्यास माझी संमती आहे.",
    start: "मूल्यांकन सुरू करा",
    starting: "पहिला प्रश्न तयार होत आहे…",
    needMic: "पुढे जाण्यासाठी मायक्रोफोन तपासा.",
    needConsent: "पुढे जाण्यासाठी संमतीचा चौकोन निवडा.",
    notConfiguredTitle: "मूल्यांकनाची तयारी झालेली नाही",
    notConfiguredBody:
      "OPENAI_API_KEY सेट केलेली नाही, त्यामुळे पहिला प्रश्न तयार करता येणार नाही.",
  },

  interview: {
    questionProgress: "प्रश्न {current} / {total}",
    assessing: "तपासले जाणारे कौशल्य: {skill}",
    playQuestion: "प्रश्न ऐका",
    audioUnavailable: "या प्रश्नाचा आवाज उपलब्ध नाही.",
    retryAudio: "आवाज पुन्हा तयार करा",
    generatingAudio: "तयार होत आहे…",
    audioFailed: "आवाज वाजू शकला नाही — तुम्ही वरील प्रश्न वाचू शकता.",
    ready: "रेकॉर्ड करण्यास तयार",
    recording: "रेकॉर्डिंग सुरू आहे",
    recorded: "रेकॉर्ड झाले",
    uploading: "अपलोड होत आहे…",
    processingStatus: "तुमचे उत्तर तपासले जात आहे…",
    startRecording: "रेकॉर्डिंग सुरू करा",
    stopRecording: "रेकॉर्डिंग थांबवा",
    submitAnswer: "उत्तर पाठवा",
    submitting: "पाठवत आहे…",
    reRecord: "पुन्हा रेकॉर्ड करा",
    next: "पुढील प्रश्न",
    finish: "मूल्यांकन पूर्ण करा",
    keepSpeaking: "बोलत राहा — तुम्ही थांबताच हे आपोआप पुढे जाईल.",
    advancingIn: "{seconds} मध्ये पुढे जात आहोत…",
    leftTab:
      "तुम्ही मुलाखतीचे पान {count} वेळा सोडले. याची नोंद होते. कृपया पूर्ण होईपर्यंत याच पानावर रहा.",
    introduction: "ओळख",
    chooseLanguageTitle: "तुम्हाला कोणत्या भाषेत पुढे जायचे आहे?",
    chooseLanguageBody:
      "त्या उत्तरावरून तुमची भाषा ओळखता आली नाही. एक निवडा, उर्वरित मुलाखत त्याच भाषेत होईल.",
    languageLabel: "भाषा",
    languageHint: "सध्याचा प्रश्न पुन्हा विचारला जाईल",
    liveCaptions: "थेट मजकूर",
    listening: "ऐकत आहे…",
    preparing: "तयारी सुरू आहे…",
    tooShort: "हे उत्तर खूप लहान होते. कृपया पुन्हा उत्तर द्या.",
    greeting:
      "नमस्कार, तुमचे स्वागत आहे. तुम्ही कामात कसे वागता याबद्दल मी काही प्रश्न विचारणार आहे. सहज उत्तर द्या — यात अवघड काही नाही.",
    savingRecordings: "तुमची रेकॉर्डिंग जतन होत आहे — जवळजवळ पूर्ण…",
    processingHint:
      "तुमचे उत्तर लिहून घेतले जात आहे आणि तपासले जात आहे. यास काही सेकंद लागतात — हे पान उघडे ठेवा.",
    errorTitle: "काहीतरी चूक झाली",
    micProblemTitle: "मायक्रोफोनमध्ये अडचण",
    recordAgain: "पुन्हा रेकॉर्ड करा",
    unavailableTitle: "मूल्यांकन उपलब्ध नाही",
    unavailableBody:
      "या मूल्यांकनात सध्या कोणताही प्रश्न नाही. मागे जाऊन पुन्हा प्रयत्न करा.",
    leaveWarning: "तुम्ही हे पान सोडल्यास तुमचे रेकॉर्डिंग जाईल.",
  },

  result: {
    title: "मूल्यांकनाचा निकाल",
    completedOn: "{date} रोजी पूर्ण झाले",
    overallScore: "एकूण गुण",
    answered: "{total} पैकी {answered} प्रश्नांची उत्तरे दिली",
    summary: "सारांश",
    strengths: "बलस्थाने",
    improvements: "सुधारणेच्या जागा",
    noStrengths: "कोणतीही विशिष्ट बलस्थाने आढळली नाहीत.",
    noImprovements: "कोणत्याही विशिष्ट सुधारणा सुचवल्या गेल्या नाहीत.",
    skillBreakdown: "कौशल्यनिहाय गुण",
    skillBreakdownHint: "दहाही कामाची कौशल्ये, प्रत्येकी १० पैकी गुण.",
    notAssessed: "तपासले नाही",
    questionBreakdown: "प्रश्ननिहाय तपशील",
    yourAnswer: "तुमचे उत्तर",
    evaluation: "मूल्यांकन",
    noAnswers: "या मूल्यांकनात कोणतेही उत्तर नोंदवले गेले नाही.",
    startAnother: "आणखी एक मूल्यांकन सुरू करा",
    allInterviews: "सर्व मूल्यांकने",
  },

  status: {
    not_started: "सुरू झालेले नाही",
    in_progress: "सुरू आहे",
    processing: "तपासले जात आहे",
    completed: "पूर्ण झाले",
    failed: "अयशस्वी",
  },

  skills: {
    reliability: "विश्वासार्हता",
    responsibility: "जबाबदारी",
    following_instructions: "सूचनांचे पालन",
    attention_to_detail: "बारकाव्यांकडे लक्ष",
    communication: "संवाद",
    teamwork: "सांघिक काम",
    problem_solving: "विचार व समस्या सोडवणे",
    learning_adaptability: "शिकणे व जुळवून घेणे",
    initiative: "पुढाकार",
    customer_orientation: "ग्राहकाभिमुखता",
  },

  errors: {
    notFoundTitle: "मूल्यांकन सापडले नाही",
    notFoundBody:
      "हे मूल्यांकन अस्तित्वात नाही, किंवा ते दुसऱ्या खात्याचे आहे.",
    reopenLink: "तुम्हाला पाठवलेली मुलाखतीची लिंक पुन्हा उघडा.",
    backToList: "मूल्यांकनांकडे परत जा",
    generic: "काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.",
    loading: "लोड होत आहे",
  },
};
