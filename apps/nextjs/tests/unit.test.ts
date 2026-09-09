import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "~/server/auth/password";
import {
  normaliseMimeType,
  validateAnswerAudio,
} from "~/server/interview/audio";
import {
  MAX_ANSWER_BYTES,
  MIN_ANSWER_BYTES,
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
