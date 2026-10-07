import { describe, expect, it } from "vitest";

import {
  AVAILABLE_INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGES,
  INTERVIEW_LANGUAGE_KEYS,
  LanguageConfigurationError,
  TRANSLATED_LANGUAGE_KEYS,
  resolveLanguage,
} from "~/config/languages";
import {
  PROBE_SPOKEN_LANGUAGE_CODE,
  PROBE_SPOKEN_TEXT,
} from "~/config/greeting";
import { MESSAGES, t } from "~/config/messages";
import { isRepeatRequest } from "~/config/repeat-requests";
import { en } from "~/config/messages/en";
import {
  WORK_SKILLS,
  WORK_SKILL_COUNT,
  WORK_SKILL_IDS,
  isFollowUpTurn,
  skillForTurn,
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

  it("still asks for a spoken introduction", () => {
    expect(PROBE_SPOKEN_TEXT.toLowerCase()).toMatch(/name/);
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

  it("covers all ten skills across a 10-question interview", () => {
    const covered = Array.from(
      { length: 10 },
      (_, i) => skillForTurn(i + 1, 10).id,
    );
    expect(new Set(covered).size).toBe(10);
    expect(covered[0]).toBe("reliability");
    expect(covered[9]).toBe("customer_orientation");
  });

  it("pairs consecutive turns per skill in a 20-question interview", () => {
    expect(skillForTurn(1, 20).id).toBe(skillForTurn(2, 20).id);
    expect(skillForTurn(3, 20).id).not.toBe(skillForTurn(2, 20).id);

    const covered = Array.from(
      { length: 20 },
      (_, i) => skillForTurn(i + 1, 20).id,
    );
    expect(new Set(covered).size).toBe(10);
  });

  it("marks the second question on a skill as a follow-up", () => {
    expect(isFollowUpTurn(1, 20)).toBe(false);
    expect(isFollowUpTurn(2, 20)).toBe(true);
    expect(isFollowUpTurn(3, 20)).toBe(false);
    // With one question per skill nothing is a follow-up.
    expect(isFollowUpTurn(2, 10)).toBe(false);
  });

  it("never runs past the last skill", () => {
    expect(skillForTurn(99, 10).id).toBe("customer_orientation");
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
