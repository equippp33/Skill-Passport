import { describe, expect, it } from "vitest";

import {
  AVAILABLE_INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGE_KEYS,
  LanguageConfigurationError,
  TRANSLATED_LANGUAGE_KEYS,
  resolveLanguage,
} from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import {
  PROBE_SPOKEN_LANGUAGE_CODE,
  PROBE_QUESTION_BY_LANGUAGE,
  wrongLanguageNoticeFor,
  PROBE_SPOKEN_TEXT,
  openerFor,
} from "~/config/greeting";
import { MESSAGES, t } from "~/config/messages";
import {
  isRepeatRequest,
  phraseIntent,
  yesNoIntent,
} from "~/config/repeat-requests";
import { en } from "~/config/messages/en";
import {
  WORK_SKILLS,
  WORK_SKILL_COUNT,
  WORK_SKILL_IDS,
} from "~/config/work-skills";
import { DEFAULT_QUESTION_COUNT } from "~/server/interview/validation";

/* -------------------------------------------------------------------------- */
/*                             Language registry                              */
/* -------------------------------------------------------------------------- */

/**
 * Codes Sarvam TTS (bulbul) accepts. STT (saaras) is a superset, so this list
 * is the real constraint on what an interview can be conducted in.
 */
const SARVAM_TTS_CODES = new Set([
  "bn-IN",
  "en-IN",
  "gu-IN",
  "hi-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
]);

describe("interview language registry", () => {
  it("only lists languages both Sarvam models support", () => {
    for (const key of INTERVIEW_LANGUAGE_KEYS) {
      expect(SARVAM_TTS_CODES.has(INTERVIEW_LANGUAGES[key].code)).toBe(true);
    }
  });

  it("has a unique BCP-47 code per language", () => {
    const codes = INTERVIEW_LANGUAGE_KEYS.map(
      (k) => INTERVIEW_LANGUAGES[k].code,
    );
    expect(new Set(codes).size).toBe(codes.length);
  });

  // The picker identifies each language by this glyph, so a missing or
  // shared one would leave two rows looking identical.
  it("gives every language a distinct, short script symbol", () => {
    const symbols = INTERVIEW_LANGUAGE_KEYS.map(
      (k) => INTERVIEW_LANGUAGES[k].symbol,
    );
    for (const symbol of symbols) {
      expect(symbol.length).toBeGreaterThan(0);
      expect([...symbol].length).toBeLessThanOrEqual(2);
    }
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("resolves Marathi to mr-IN", () => {
    const lang = resolveLanguage("marathi");
    expect(lang.code).toBe("mr-IN");
    expect(lang.promptName).toBe("Marathi");
    expect(lang.displayName).toBe("मराठी");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveLanguage("  Marathi ").key).toBe("marathi");
  });

  it("throws on an unknown language instead of falling back", () => {
    expect(() => resolveLanguage("klingon")).toThrow(
      LanguageConfigurationError,
    );
    // The message must tell the operator what IS allowed.
    expect(() => resolveLanguage("klingon")).toThrow(/marathi/);
  });

  it("throws a distinct message for a Sarvam language with no UI translation", () => {
    // Telugu is supported by Sarvam but has no dictionary yet.
    expect(() => resolveLanguage("telugu")).toThrow(LanguageConfigurationError);
    expect(() => resolveLanguage("telugu")).toThrow(/no UI translation/);
  });

  it("offers only fully translated languages to a selector", () => {
    const offered = AVAILABLE_INTERVIEW_LANGUAGES.map((l) => l.key);
    expect(offered).toEqual([...TRANSLATED_LANGUAGE_KEYS]);
    for (const key of offered) {
      expect(MESSAGES[key]).toBeDefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                              Message catalogue                             */
/* -------------------------------------------------------------------------- */

function leafKeys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? leafKeys(v as object, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("language probe opener", () => {
  it("is spoken in English", () => {
    expect(PROBE_SPOKEN_LANGUAGE_CODE).toBe("en-IN");
  });

  // Detection reads whatever language the candidate replies in, so the
  // question does not need to mention language — and mentioning it makes
  // the opener feel like a test rather than an interview question.
  it("does not instruct the candidate about which language to use", () => {
    expect(PROBE_SPOKEN_TEXT.toLowerCase()).not.toMatch(/language/);
  });

  // The opener used to ask for their name and their work. Both are now
  // collected before the interview starts — the details step and the
  // background box — so asking again made the first thing the candidate heard
  // a repeat of the form they had just filled in. It is a warm-up now: one
  // easy, open question that gets them talking.
  it("is one short, easy, open question", () => {
    const spoken = openerFor("english", "Priya");
    expect(spoken.toLowerCase()).not.toMatch(/your name/);
    expect(spoken.split("?")).toHaveLength(2);
    expect(spoken.split(/\s+/).length).toBeLessThan(35);
  });

  // The name goes in the greeting, where it falls naturally in all eleven
  // languages — and the slot must never survive into something spoken aloud.
  it("greets every candidate by name, in every language", () => {
    for (const key of Object.keys(
      PROBE_QUESTION_BY_LANGUAGE,
    ) as InterviewLanguageKey[]) {
      expect(PROBE_QUESTION_BY_LANGUAGE[key]).toContain("{name}");
      expect(openerFor(key, "Priya")).toContain("Priya");
      expect(openerFor(key, "Priya")).not.toContain("{name}");
    }
  });

  // An attempt created without a usable name still has to read as speech.
  it("reads naturally when there is no name", () => {
    for (const key of Object.keys(
      PROBE_QUESTION_BY_LANGUAGE,
    ) as InterviewLanguageKey[]) {
      const spoken = openerFor(key, null);
      expect(spoken).not.toContain("{name}");
      expect(spoken).not.toMatch(/\s,/);
    }
  });
});

describe("repeat requests", () => {
  it.each([
    "Repeat",
    "Can you repeat that?",
    "Say that again please",
    "Sorry, what was that?",
    "One more time",
    "phir se boliye",
    "vapas bolo",
    "dobara bolo",
    "punha sanga",
    "फिर से बोलिए",
    "वापस बोलो",
    "पुन्हा सांगा",
    "மீண்டும் சொல்லுங்கள்",
    "మళ్లీ చెప్పండి",
  ])("recognises %s", (text) => {
    expect(isRepeatRequest(text)).toBe(true);
  });

  /**
   * The costly mistake is the false positive: discarding a real answer.
   * These all contain a trigger word but are answers, not requests.
   */
  it.each([
    "I repeat the stock checklist every morning before the shop opens, so nothing is missed.",
    "When a customer could not hear me over the noise, I walked closer and said it again clearly.",
    "My manager asked me to repeat the order back to the customer every time to avoid mistakes.",
    "Once again the delivery was late, so I called the supplier myself and arranged a new slot.",
  ])("does not fire on a real answer: %s", (text) => {
    expect(isRepeatRequest(text)).toBe(false);
  });

  it.each(["I always arrive on time", "Yes", "", "   "])(
    "does not fire on %s",
    (text) => {
      expect(isRepeatRequest(text)).toBe(false);
    },
  );
});

/**
 * The three asks route to three different responses — the same clip again, the
 * same clip slower, or a simpler wording — so telling them apart is the whole
 * point of splitting the list.
 */
describe("utterance intent", () => {
  it.each([
    ["Repeat", "repeat"],
    ["Can you say that again?", "repeat"],
    ["फिर से बोलिए", "repeat"],
    ["Please speak slowly", "slower"],
    ["थोड़ा धीरे बोलिए", "slower"],
    ["I did not understand", "not_understood"],
    ["samajh nahi aaya", "not_understood"],
    ["What do you mean?", "not_understood"],
  ] as const)("reads %s as %s", (text, intent) => {
    expect(phraseIntent(text)).toBe(intent);
  });

  /**
   * Order matters, and this is the case that proves it. "Say it again,
   * slowly" contains the repeat needle too; checking repeat first would
   * swallow it and the candidate would get the same speed back.
   */
  it("prefers the slow request when the phrasing also says 'again'", () => {
    expect(phraseIntent("फिर से धीरे बोलिए")).toBe("slower");
  });

  it.each([
    "I always arrive on time",
    "My manager asked me to repeat the order back to the customer every time.",
  ])("reads a real answer as an answer: %s", (text) => {
    expect(phraseIntent(text)).toBeNull();
  });
});

describe("message dictionaries", () => {
  const expected = leafKeys(en).sort();

  it("every language defines every key", () => {
    for (const [key, dict] of Object.entries(MESSAGES)) {
      expect({ key, keys: leafKeys(dict).sort() }).toEqual({
        key,
        keys: expected,
      });
    }
  });

  it("non-English dictionaries are actually translated", () => {
    // Guards against a dictionary that was copied but never translated.
    expect(MESSAGES.marathi.instructions.start).not.toBe(en.instructions.start);
    expect(MESSAGES.hindi.instructions.start).not.toBe(en.instructions.start);
  });

  it("names all ten skills in every language", () => {
    for (const dict of Object.values(MESSAGES)) {
      for (const id of WORK_SKILL_IDS) {
        expect(dict.skills[id]).toBeTruthy();
      }
    }
  });

  it("substitutes placeholders and leaves unknown ones visible", () => {
    expect(t("Question {current} of {total}", { current: 2, total: 10 })).toBe(
      "Question 2 of 10",
    );
    expect(t("Hello {missing}")).toBe("Hello {missing}");
  });
});

/* -------------------------------------------------------------------------- */
/*                             Work-skill framework                           */
/* -------------------------------------------------------------------------- */

describe("work skill framework", () => {
  it("has exactly the ten required skills", () => {
    expect(WORK_SKILL_COUNT).toBe(10);
    expect(WORK_SKILLS.map((s) => s.id)).toEqual([...WORK_SKILL_IDS]);
  });

  it("gives every skill a definition and a scenario", () => {
    for (const skill of WORK_SKILLS) {
      expect(skill.definition.length).toBeGreaterThan(20);
      expect(skill.scenarioFocus.length).toBeGreaterThan(10);
    }
  });

  it("defaults to exactly one question per skill", () => {
    // No setup step, so the length is fixed by the framework itself.
    expect(DEFAULT_QUESTION_COUNT).toBe(WORK_SKILL_COUNT);
  });
});

/* -------------------------------------------------------------------------- */
/*                        UI vs interview language split                      */
/* -------------------------------------------------------------------------- */

describe("UI and interview languages are independent", () => {
  it("resolves each side from its own env var", async () => {
    const { uiLanguage, configuredInterviewLanguage } =
      await import("~/server/language");
    // tests/setup-env.ts sets english + marathi, mirroring the deployment.
    expect(uiLanguage().key).toBe("english");
    expect(configuredInterviewLanguage().key).toBe("marathi");
    expect(configuredInterviewLanguage().code).toBe("mr-IN");
  });

  it("serves English chrome while the interview stays Marathi", async () => {
    const { uiMessages, sessionLanguage } = await import("~/server/language");
    const m = uiMessages();

    // Chrome is English...
    expect(m.interview.submitAnswer).toBe("Submit answer");
    expect(m.skills.reliability).toBe("Reliability");
    // ...while a session started in Marathi still drives Sarvam.
    expect(sessionLanguage("marathi").code).toBe("mr-IN");
  });
});

describe("replies to a yes-or-no question", () => {
  it.each([
    ["no", "no"],
    ["No, that's all", "no"],
    ["नहीं", "no"],
    ["बस इतना ही", "no"],
    ["இல்லை", "no"],
    ["లేదు", "no"],
  ])("reads %j as a refusal", (text, expected) => {
    expect(yesNoIntent(text)).toBe(expected);
  });

  it.each([
    ["yes", "yes"],
    ["हाँ", "yes"],
    ["ஆமாம்", "yes"],
    ["అవును", "yes"],
  ])("reads %j as an acceptance", (text, expected) => {
    expect(yesNoIntent(text)).toBe(expected);
  });

  /**
   * The common case, and the one worth protecting: the candidate ignores the
   * question and simply keeps answering. That continuation is the thing we
   * were asking for, so it must not be mistaken for a yes or a no — plenty of
   * real answers contain "no" somewhere in the middle.
   */
  it.each([
    "I checked the order twice so there were no mistakes",
    "We had to close the shop, so I stayed back and finished it",
    "मैंने दोबारा जाँच की ताकि कोई गलती न हो",
  ])("treats a real answer as neither: %j", (text) => {
    expect(yesNoIntent(text)).toBeNull();
  });
});

describe("answering in a language that was not chosen", () => {
  // Said in the language being SPOKEN, naming the one that was picked. The
  // other way round is the failure the candidate is already having.
  it("speaks to the candidate in the language they are using", () => {
    const said = wrongLanguageNoticeFor("telugu", "hindi");
    expect(said).toContain(INTERVIEW_LANGUAGES.hindi.displayName);
    expect(said).not.toContain("{language}");
    // Telugu script, because that is what they are speaking.
    expect(said).toMatch(/[ఀ-౿]/);
  });

  it("fills the slot in every language", () => {
    for (const spoken of INTERVIEW_LANGUAGE_KEYS) {
      const said = wrongLanguageNoticeFor(spoken, "marathi");
      expect(said).not.toContain("{language}");
      expect(said).toContain(INTERVIEW_LANGUAGES.marathi.displayName);
    }
  });
});

describe("talking to the interviewer instead of answering", () => {
  it.each([
    "what is your name",
    "who are you",
    "are you a robot",
    "what should I say",
    "just tell me",
    "आपका नाम क्या है",
    "मुझे क्या बोलूं",
  ])("reads %j as off topic", (text) => {
    expect(phraseIntent(text)).toBe("off_topic");
  });

  /**
   * Order is load-bearing. "What do you mean?" is a genuine doubt and must
   * reach the simpler wording; matching the off-topic list first would send
   * it to the redirect instead.
   */
  it("does not swallow a genuine doubt", () => {
    expect(phraseIntent("what do you mean")).toBe("not_understood");
    expect(phraseIntent("samajh nahi aaya")).toBe("not_understood");
  });

  // A real answer that happens to mention a name must never be redirected.
  it.each([
    "My manager asked for my name and I gave it to him",
    "I told the customer what I should say to the supervisor",
  ])("leaves a real answer alone: %j", (text) => {
    expect(phraseIntent(text)).toBeNull();
  });
});

describe("a longer request in reply to a prompt", () => {
  const LONG = "sorry sir please say the question again i did not understand";

  // Twelve words. As an answer it is over the cap and stays an answer; as a
  // reply to "would you like to add anything?" there is no answer to protect,
  // and treating it as one ended the question and moved the interview on.
  it("is missed as an answer but caught as a reply", () => {
    expect(phraseIntent(LONG)).toBeNull();
    expect(phraseIntent(LONG, true)).toBe("not_understood");
  });
});

describe("yes or no, matched on whole words", () => {
  // "no" inside "I do not know" used to read as a refusal, which threw the
  // candidate's actual words away and advanced the interview.
  it.each(["i do not know", "i really do not know sir"])(
    "does not read %j as a refusal",
    (text) => {
      expect(yesNoIntent(text)).not.toBe("no");
    },
  );

  it("still reads a plain refusal", () => {
    expect(yesNoIntent("no")).toBe("no");
    expect(yesNoIntent("nothing else")).toBe("no");
  });
});
