import { describe, expect, it } from "vitest";

import {
  looksLikeSttHallucination,
  stripSttHallucinations,
} from "~/lib/stt-sanity";

describe("stripSttHallucinations", () => {
  it("keeps a real answer and drops the invention tacked onto its end", () => {
    expect(
      stripSttHallucinations(
        "I'll seek help from resources in the office. Okay, so I'm going to try and do a little bit of a video today.",
      ),
    ).toBe("I'll seek help from resources in the office.");
    expect(
      stripSttHallucinations(
        "I think I'm done. Next question. Okay, so I'm going to try and connect this to the phone. Okay, so",
      ),
    ).toBe("I think I'm done. Next question.");
  });

  it("returns empty when nothing real was said", () => {
    expect(
      stripSttHallucinations(
        "Okay Okay Okay, so this is the same type of problem that we were trying to solve. Okay, so Okay, so",
      ),
    ).toBe("");
  });

  it("leaves a real answer untouched", () => {
    const real = "My name is Rahul. I am from Pune and I like cricket.";
    expect(stripSttHallucinations(real)).toBe(real);
  });
});

describe("looksLikeSttHallucination", () => {
  it("flags the invented phrases seen on silent answers", () => {
    for (const invented of [
      "Okay Okay Okay, so this is the same type of problem that we were trying to solve. Okay, so Okay, so",
      "Okay, so I'm going to try and connect this to the phone. Okay, so",
      "Okay, so I'm going to try and do a little bit of a video today.",
      "Okay, so I'm going to add a little bit of oil to this.",
      "Okay, so I'm going to try and connect this to the system.",
    ]) {
      expect(looksLikeSttHallucination(invented)).toBe(true);
    }
  });

  it("flags pure looping filler", () => {
    expect(looksLikeSttHallucination("Okay okay okay so")).toBe(true);
    expect(looksLikeSttHallucination("Okay, okay, okay.")).toBe(true);
  });

  it("keeps real answers that repeat words (the old rule rejected these)", () => {
    for (const real of [
      // A word pair three times — normal speech.
      "I will talk to my friend. I will explain the issue and I will help him finish the work first.",
      "when I when I disagree with my friends there is some reason there is some reason I will I will politely talk",
      "नमस्ते, मेरा नाम सुमित है। मुझे ट्रैवलिंग करना पसंद है और फोटोग्राफी करना पसंद है।",
      "मी माझ्या मित्राला मदत करेन. मी त्याला सांगेन की मी त्याला सिम कार्ड टाकायला मदत करेन.",
      // Filler at the start, then a real answer.
      "okay okay okay, my name is Rahul and I am from Pune",
      // Hesitation that is not filler.
      "I I I think teamwork is important because everyone helps each other",
    ]) {
      expect(looksLikeSttHallucination(real)).toBe(false);
    }
  });

  it("never rejects short genuine answers", () => {
    for (const short of ["Yes", "No", "Okay", "Pune", "I don't know"]) {
      expect(looksLikeSttHallucination(short)).toBe(false);
    }
  });
});
