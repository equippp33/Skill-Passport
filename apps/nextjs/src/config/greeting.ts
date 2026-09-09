import { INTERVIEW_LANGUAGES } from "./languages";

/**
 * The language probe: turn 1 of every attempt.
 *
 * At this point we do not know what the candidate speaks, so the opener is
 * deliberately language-neutral. It is shown in several scripts and spoken in
 * a configurable neutral language, and it invites the candidate to reply in
 * whichever language they are comfortable with. Sarvam then identifies the
 * language from that reply.
 *
 * It is NOT scored — it exists to hear the candidate speak.
 */

/** Spoken aloud for the probe, before any language is known. */
export const PROBE_SPOKEN_LANGUAGE_CODE = INTERVIEW_LANGUAGES.english.code;

export const PROBE_SPOKEN_TEXT =
  "Hello, and welcome to your interview. Please answer in the language you " +
  "are most comfortable with. To begin, tell me your name and a little " +
  "about the work you have done.";

/**
 * Shown on screen alongside the spoken opener.
 *
 * A candidate who does not read English still sees the invitation in a script
 * they recognise. Kept short on purpose — this is a prompt to start talking,
 * not instructions to study.
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
