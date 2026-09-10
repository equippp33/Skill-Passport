import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "~/server/auth/password";
import { normalisePhoneInput, phoneDigits } from "~/lib/phone";
import { safeReturnTo } from "~/lib/return-to";
import { formatSpokenLanguages, spokenLanguages } from "~/lib/spoken-languages";
import {
  normaliseMimeType,
  validateAnswerAudio,
} from "~/server/interview/audio";
import {
  MAX_ANSWER_BYTES,
  MIN_ANSWER_BYTES,
  candidateDetailsSchema,
  loginSchema,
  uuidSchema,
} from "~/server/interview/validation";

/* -------------------------------------------------------------------------- */
/*                              Password hashing                              */
/* -------------------------------------------------------------------------- */

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery");
    await expect(verifyPassword(hash, "correct horse battery")).resolves.toBe(
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery");
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });

  it("does not throw on a malformed stored hash", async () => {
    await expect(verifyPassword("not-a-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
    await expect(verifyPassword("scrypt$x$y$z$$", "anything")).resolves.toBe(
      false,
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                             Audio validation                               */
/* -------------------------------------------------------------------------- */

describe("answer audio validation", () => {
  it("strips codec parameters from the mime type", () => {
    expect(normaliseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normaliseMimeType("AUDIO/WEBM")).toBe("audio/webm");
  });

  it("accepts a normal webm recording", () => {
    const result = validateAnswerAudio(50_000, "audio/webm;codecs=opus");
    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe("audio/webm");
  });

  it("accepts Safari's mp4 container", () => {
    expect(validateAnswerAudio(50_000, "audio/mp4").ok).toBe(true);
  });

  it("rejects a non-audio mime type", () => {
    const result = validateAnswerAudio(50_000, "application/zip");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects an empty recording", () => {
    expect(validateAnswerAudio(MIN_ANSWER_BYTES - 1, "audio/webm").ok).toBe(
      false,
    );
  });

  it("rejects an oversized recording", () => {
    expect(validateAnswerAudio(MAX_ANSWER_BYTES + 1, "audio/webm").ok).toBe(
      false,
    );
  });
});

/* -------------------------------------------------------------------------- */
/*                              Input validation                              */
/* -------------------------------------------------------------------------- */

describe("loginSchema", () => {
  it("lowercases the email", () => {
    const parsed = loginSchema.parse({
      email: "Candidate@Example.COM",
      password: "password123",
    });
    expect(parsed.email).toBe("candidate@example.com");
  });

  it("rejects a short password", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "short" }).success,
    ).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(
      loginSchema.safeParse({ email: "nope", password: "password123" }).success,
    ).toBe(false);
  });
});

describe("candidate phone number", () => {
  function phone(input: string) {
    return candidateDetailsSchema.safeParse({ name: "Ashvith", phone: input });
  }

  it("accepts ten digits", () => {
    const result = phone("9876543210");
    expect(result.success && result.data.phone).toBe("9876543210");
  });

  // Rejecting these would be pedantry — people type numbers with separators.
  it.each([
    ["98765 43210", "spaces"],
    ["98765-43210", "dashes"],
    ["+91 98765 43210", "country code"],
    ["09876543210", "trunk zero"],
    ["(98765) 43210", "brackets"],
  ])("normalises %s (%s) to ten bare digits", (input) => {
    const result = phone(input);
    expect(result.success && result.data.phone).toBe("9876543210");
  });

  it.each([["98765"], ["987654321"], ["98765432101"], ["12345678901234"]])(
    "rejects %s",
    (input) => {
      expect(phone(input).success).toBe(false);
    },
  );

  it("stays optional", () => {
    for (const input of ["", "   ", undefined]) {
      const result = candidateDetailsSchema.safeParse({
        name: "Ashvith",
        phone: input,
      });
      expect(result.success && result.data.phone).toBeNull();
    }
  });

  // "+91 98765 43210" is 12 digits before stripping; the trunk/country rule
  // must not fire on a number that is already the wrong length.
  it("does not strip a leading 9 or 0 from a wrong-length number", () => {
    expect(phone("919876543").success).toBe(false);
    expect(phone("0987654321012").success).toBe(false);
  });
});

describe("phone input as you type", () => {
  it("refuses an eleventh digit", () => {
    expect(normalisePhoneInput("9876543210")).toBe("9876543210");
    // The keystroke that would make it eleven leaves the field unchanged.
    expect(normalisePhoneInput("98765432101")).toBe("9876543210");
    expect(normalisePhoneInput("99020020202020202")).toBe("9902002020");
  });

  it("collapses a pasted number to the ten digits it means", () => {
    expect(normalisePhoneInput("+91 98765 43210")).toBe("9876543210");
    expect(normalisePhoneInput("098765 43210")).toBe("9876543210");
    expect(normalisePhoneInput("(98765) 43210")).toBe("9876543210");
  });

  /**
   * Order matters: capping first would cut "+91 98765 43210" down to
   * "9198765432", which is a different number entirely.
   */
  it("strips the country code before capping, not after", () => {
    expect(normalisePhoneInput("919876543210")).toBe("9876543210");
    expect(normalisePhoneInput("919876543210")).not.toBe("9198765432");
  });

  it("lets a partial number through while it is being typed", () => {
    expect(normalisePhoneInput("987")).toBe("987");
    expect(normalisePhoneInput("")).toBe("");
  });

  // The server must NOT truncate — a shortened number is a number someone
  // else owns, so it has to be rejected instead.
  it("does not truncate on the server side", () => {
    expect(phoneDigits("99020020202020202")).toBe("99020020202020202");
    expect(phoneDigits("98765432101")).toBe("98765432101");
  });
});

describe("languages a candidate spoke", () => {
  const turn = (detectedLanguageCode: string | null) => ({
    detectedLanguageCode,
  });

  it("orders by how many answers were given in each", () => {
    // Ashvith's real attempt: mostly Hindi, some English, one Telugu.
    const spoken = spokenLanguages([
      turn("hi-IN"),
      turn("hi-IN"),
      turn("te-IN"),
      turn("en-IN"),
      turn("en-IN"),
      turn("hi-IN"),
      turn("en-IN"),
    ]);

    expect(spoken.map((s) => s.label)).toEqual(["हिंदी", "English", "తెలుగు"]);
  });

  it("counts the answers per language", () => {
    const spoken = spokenLanguages([
      turn("hi-IN"),
      turn("hi-IN"),
      turn("en-IN"),
    ]);
    expect(spoken[0]).toMatchObject({ code: "hi-IN", turns: 2 });
    expect(spoken[1]).toMatchObject({ code: "en-IN", turns: 1 });
  });

  it("ignores turns with nothing detected yet", () => {
    expect(
      spokenLanguages([turn(null), turn("  "), turn("en-IN")]),
    ).toHaveLength(1);
  });

  // An STT-only language has no entry in our registry; showing the raw code
  // beats showing nothing.
  it("falls back to the raw code for a language it does not know", () => {
    const [only] = spokenLanguages([turn("as-IN")]);
    expect(only).toMatchObject({ code: "as-IN", label: "as-IN" });
  });

  it("joins them for a list row", () => {
    const spoken = spokenLanguages([turn("hi-IN"), turn("en-IN")]);
    expect(formatSpokenLanguages(spoken, "english")).toBe("हिंदी, English");
  });

  it("falls back to the attempt language before anything is detected", () => {
    expect(formatSpokenLanguages([], "marathi")).toBe("मराठी");
    expect(formatSpokenLanguages([], null)).toBe("language pending");
  });
});

describe("back-link target", () => {
  it("keeps a path inside the admin area", () => {
    expect(safeReturnTo("/admin")).toBe("/admin");
    expect(safeReturnTo("/admin/interviews")).toBe("/admin/interviews");
    expect(safeReturnTo("/admin?interview=abc")).toBe("/admin?interview=abc");
    expect(safeReturnTo("/admin/interviews?interview=abc")).toBe(
      "/admin/interviews?interview=abc",
    );
  });

  /**
   * The value comes off the address bar, so each of these would otherwise
   * render as a link that looks like part of the app and is not.
   */
  it.each([
    ["//evil.example/x", "protocol-relative"],
    ["/\\evil.example/x", "backslash-relative"],
    ["https://evil.example", "absolute URL"],
    ["javascript:alert(1)", "script URI"],
    ["/adminevil.example", "prefix that is not a segment"],
    ["/attempt/abc", "elsewhere in the app"],
    ["admin/interviews", "not rooted"],
    ["", "empty"],
  ])("rejects %s (%s)", (input) => {
    expect(safeReturnTo(input)).toBe("/admin/interviews");
  });

  it("rejects a path carrying control characters", () => {
    expect(safeReturnTo("/admin/x" + String.fromCharCode(10) + "y")).toBe(
      "/admin/interviews",
    );
    expect(safeReturnTo("/admin/x" + String.fromCharCode(0))).toBe(
      "/admin/interviews",
    );
  });

  it("falls back to whatever the caller nominates", () => {
    expect(safeReturnTo(undefined, "/admin")).toBe("/admin");
  });
});

describe("uuidSchema", () => {
  it("rejects a non-uuid route param", () => {
    expect(uuidSchema.safeParse("../../etc/passwd").success).toBe(false);
    expect(uuidSchema.safeParse("1").success).toBe(false);
  });

  it("accepts a real uuid", () => {
    expect(
      uuidSchema.safeParse("3f2504e0-4f89-11d3-9a0c-0305e82c3301").success,
    ).toBe(true);
  });
});
