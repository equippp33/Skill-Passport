import { INTERVIEW_LANGUAGES } from "./languages";

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
