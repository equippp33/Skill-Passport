import type { WorkSkillId } from "../work-skills";

/**
 * English is the reference dictionary. Every other language must satisfy the
 * `Messages` type derived from it, so a missing string is a type error rather
 * than an English word leaking into a Marathi interview.
 */
export const en = {
  app: {
    name: "Skill Passport",
    tagline: "Workplace skills assessment",
    signOut: "Sign out",
    skipToContent: "Skip to content",
    back: "Back",
  },

  login: {
    title: "Sign in",
    subtitle: "Use your email and password.",
    intro: "Sign in to start your assessment.",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    invalid: "Incorrect email or password.",
    emailRequired: "Enter your email address.",
    emailInvalid: "Enter a valid email address.",
    passwordRequired: "Password must be at least 8 characters.",
    noAccount: "New here?",
    signUpLink: "Create an account",
  },

  signup: {
    title: "Create account",
    subtitle: "Use your email and a password.",
    intro: "Create an account to start your assessment.",
    submit: "Create account",
    submitting: "Creating account…",
    passwordHint: "At least 8 characters.",
    emailTaken: "An account with that email already exists. Sign in instead.",
    haveAccount: "Already have an account?",
    signInLink: "Sign in",
  },

  dashboard: {
    title: "Assessments",
    subtitle:
      "Practise a workplace-skills interview and get structured feedback.",
    newInterview: "Start new assessment",
    emptyTitle: "No assessments yet",
    emptyBody:
      "Start your first workplace-skills assessment. It covers ten work skills, one question at a time.",
    statusLabel: "Status",
    scoreLabel: "Score",
    questions: "questions",
    assessmentName: "Workplace skills assessment",
    continue: "Continue",
    viewResult: "View result",
    notConfiguredTitle: "Assessments are not configured",
    notConfiguredBody:
      "OPENAI_API_KEY is not set, so new assessments cannot start. You can still browse the app and review past assessments.",
  },

  instructions: {
    title: "Before you begin",
    expectTitle: "What to expect",
    expectSubtitle:
      "One question at a time. Listen, answer out loud, then press Next.",
    duration: "about {minutes} minutes",
    skillsCovered:
      "It assesses ten workplace skills, such as reliability, teamwork and communication.",
    answerLimit:
      "Each answer can be up to {seconds} seconds. Recording starts on its own once the question has been read out.",
    microphone:
      "You need a working microphone and a quiet place — background noise reduces accuracy.",
    recorded:
      "Your answers are recorded, transcribed and evaluated automatically to produce feedback and a score.",
    noRetake:
      "Answers cannot be re-recorded, so take a moment to think before you speak.",
    notHiring: "This is practice only — it is not a hiring decision.",
    languageNotice:
      "The whole assessment — questions, your answers and the report — is in {language}.",
    ownLanguageTitle: "You can answer in your own language",
    groupHowItWorks: "How it works",
    groupWhatYouNeed: "What you need",
    groupYourAnswers: "Your answers",
    micCheckTitle: "Microphone check",
    micCheckSubtitle: "Grant access so the assessment can record your answers.",
    micTest: "Test microphone",
    micTesting: "Requesting…",
    micRetest: "Test again",
    micReady: "Microphone ready",
    micAndCameraReady: "Microphone and camera ready",
    cameraOptional: "You can continue with audio only.",
    micReadyNoCamera: "Microphone ready (no camera — audio only)",
    camera:
      "Your webcam is recorded alongside your answer. If you decline the camera, the assessment still works with audio only.",
    micUntested: "Not tested yet",
    micUnavailable: "Microphone unavailable",
    consent:
      "I agree to my answers being recorded, transcribed and evaluated automatically to generate feedback.",
    start: "Start assessment",
    starting: "Preparing first question…",
    needMic: "Test your microphone to continue.",
    needConsent: "Tick the consent box to continue.",
    notConfiguredTitle: "Assessments are not configured",
    notConfiguredBody:
      "OPENAI_API_KEY is not set, so the first question cannot be generated.",
  },

  interview: {
    questionProgress: "Question {current} of {total}",
    assessing: "Assessing: {skill}",
    playQuestion: "Hear the question",
    audioUnavailable: "Audio unavailable for this question.",
    retryAudio: "Retry audio",
    generatingAudio: "Generating…",
    audioFailed:
      "The audio could not play — you can still read the question above.",
    ready: "Ready to record",
    recording: "Recording",
    recorded: "Recorded",
    uploading: "Uploading…",
    processingStatus: "Processing your answer…",
    startRecording: "Start recording",
    stopRecording: "Stop recording",
    submitAnswer: "Submit answer",
    submitting: "Submitting…",
    reRecord: "Re-record",
    next: "Next question",
    finish: "Finish assessment",
    keepSpeaking: "Keep speaking — this moves on by itself when you stop.",
    advancingIn: "Moving on in {seconds}…",
    introduction: "Introduction",
    chooseLanguageTitle: "Which language would you like to continue in?",
    chooseLanguageBody:
      "We could not identify your language from that answer. Choose one and the rest of the interview will be in it.",
    languageLabel: "Language",
    languageHint: "Re-asks the current question",
    liveCaptions: "Live captions",
    listening: "Listening…",
    preparing: "Getting ready…",
    tooShort: "That answer was too short. Please answer again.",
    greeting:
      "Hello, and welcome. I will ask you a few questions about how you work. Answer naturally — there are no trick questions.",
    savingRecordings: "Saving your recordings — nearly done…",
    processingHint:
      "Transcribing and evaluating your answer. This usually takes a few seconds — keep this tab open.",
    errorTitle: "Something went wrong",
    micProblemTitle: "Microphone problem",
    recordAgain: "Record again",
    unavailableTitle: "Assessment unavailable",
    unavailableBody:
      "This assessment has no active question. Go back and try again.",
    leaveWarning: "Your recording will be lost if you leave this page.",
  },

  result: {
    title: "Assessment result",
    completedOn: "Completed {date}",
    overallScore: "Overall score",
    answered: "{answered} of {total} questions answered",
    summary: "Summary",
    strengths: "Strong areas",
    improvements: "Areas to improve",
    noStrengths: "No specific strengths were identified.",
    noImprovements: "No specific improvements were identified.",
    skillBreakdown: "Skill scores",
    skillBreakdownHint: "All ten workplace skills, scored out of 10.",
    notAssessed: "Not assessed",
    questionBreakdown: "Question breakdown",
    yourAnswer: "Your answer",
    evaluation: "Evaluation",
    noAnswers: "No answers were recorded for this assessment.",
    startAnother: "Start another assessment",
    allInterviews: "All assessments",
  },

  status: {
    not_started: "Not started",
    in_progress: "In progress",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
  },

  skills: {
    reliability: "Reliability",
    responsibility: "Responsibility",
    following_instructions: "Following Instructions",
    attention_to_detail: "Attention to Detail",
    communication: "Communication",
    teamwork: "Teamwork",
    problem_solving: "Thinking and Problem Solving",
    learning_adaptability: "Learning and Adaptability",
    initiative: "Initiative",
    customer_orientation: "Customer Orientation",
  } satisfies Record<WorkSkillId, string>,

  errors: {
    notFoundTitle: "Assessment not found",
    notFoundBody:
      "This assessment does not exist, or it belongs to another account.",
    reopenLink: "Please open the interview link you were sent again.",
    backToList: "Back to assessments",
    generic: "Something went wrong. Please try again.",
    loading: "Loading",
  },
};

/**
 * Shape every dictionary must satisfy. Derived from the English one, with
 * literals widened, so adding a key to `en` makes every other language fail to
 * compile until it is translated.
 */
export type Messages = typeof en;
