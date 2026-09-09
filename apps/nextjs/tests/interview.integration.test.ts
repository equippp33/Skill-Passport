import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

import { db } from "~/server/db";
import {
  interviewAttemptsTable,
  interviewAudioTable,
  interviewTurnsTable,
  interviewsTable,
  usersTable,
} from "~/server/db/schema";
import { deleteAudioObject } from "~/server/interview/storage";
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { isUniqueViolation } from "~/lib/auth-errors";
import { lucia } from "~/server/auth/lucia";
import { loginSchema } from "~/server/interview/validation";
import {
  createInterview,
  generateToken,
  getAttemptForAdmin,
  getInterviewForAdmin,
  listInterviews,
} from "~/server/admin/service";
import {
  AttemptError,
  aggregateSkillScores,
  createAttempt,
  getTurns,
  startAttempt,
  submitAnswer,
} from "~/server/attempt/service";
import { LANGUAGE_PROBE_TURN, skillForAttemptTurn } from "~/config/work-skills";

/**
 * Integration tests for the admin/candidate split.
 *
 * These need a real Postgres with migrations applied and real R2 credentials
 * (answer submission writes a recording). They skip, rather than fail, when
 * either is absent so the default run stays hermetic.
 *
 * `startAttempt` does make one real Sarvam TTS call to voice the language
 * probe, which is why the timeouts are raised. OpenAI is never called:
 * `processTurn` is not invoked from here.
 */
const hasDb = process.env.__SKILL_PASSPORT_HAS_DB === "1";
const hasR2 = process.env.__SKILL_PASSPORT_HAS_R2 === "1";

const fakeAudio = Buffer.alloc(2048, 1);

describe.skipIf(!hasDb || !hasR2)("admin and candidate separation", () => {
  let alice = "";
  let mallory = "";
  const createdUsers: string[] = [];

  beforeAll(async () => {
    // Sweep orphans from any earlier run killed before its afterAll.
    await db.delete(usersTable).where(like(usersTable.email, "%@test.local"));

    const passwordHash = await hashPassword("password12345");
    const suffix = Date.now();

    const [a] = await db
      .insert(usersTable)
      .values({
        email: `admin+${suffix}@test.local`,
        passwordHash,
        role: "admin",
      })
      .returning({ id: usersTable.id });
    const [b] = await db
      .insert(usersTable)
      .values({
        email: `other+${suffix}@test.local`,
        passwordHash,
        role: "admin",
      })
      .returning({ id: usersTable.id });

    alice = a!.id;
    mallory = b!.id;
    createdUsers.push(alice, mallory);
  });

  afterAll(async () => {
    if (createdUsers.length === 0) return;

    // Rows cascade from the user; R2 objects do not.
    const interviews = await db
      .select({ id: interviewsTable.id })
      .from(interviewsTable)
      .where(inArray(interviewsTable.createdByUserId, createdUsers));

    if (interviews.length > 0) {
      const attempts = await db
        .select({ id: interviewAttemptsTable.id })
        .from(interviewAttemptsTable)
        .where(
          inArray(
            interviewAttemptsTable.interviewId,
            interviews.map((i) => i.id),
          ),
        );
      if (attempts.length > 0) {
        const audio = await db
          .select({ storageKey: interviewAudioTable.storageKey })
          .from(interviewAudioTable)
          .where(
            inArray(
              interviewAudioTable.attemptId,
              attempts.map((a) => a.id),
            ),
          );
        await Promise.all(audio.map((a) => deleteAudioObject(a.storageKey)));
      }
    }

    await db.delete(usersTable).where(inArray(usersTable.id, createdUsers));
  });

  async function newInterview(adminId: string, title = "Test interview") {
    return createInterview(adminId, { title, description: null });
  }

  async function newAttempt(adminId: string) {
    const interview = await newInterview(adminId);
    const { attemptId } = await createAttempt(interview, {
      name: "Candidate One",
      email: null,
      phone: null,
    });
    return { interview, attemptId };
  }

  /* ------------------------------ share tokens ----------------------------- */

  it("gives every interview an unguessable, unique public token", async () => {
    const a = await newInterview(alice);
    const b = await newInterview(alice);

    expect(a.publicToken).not.toBe(b.publicToken);
    // 32 random bytes as base64url: long, and not a sequential id.
    expect(a.publicToken.length).toBeGreaterThanOrEqual(40);
    expect(a.publicToken).not.toContain(a.id);
  });

  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });

  /* ----------------------------- admin ownership --------------------------- */

  it("hides one admin's interview from another", async () => {
    const interview = await newInterview(alice);

    await expect(
      getInterviewForAdmin(alice, interview.id),
    ).resolves.not.toBeNull();
    await expect(
      getInterviewForAdmin(mallory, interview.id),
    ).resolves.toBeNull();
  });

  it("keeps admins' interview lists separate", async () => {
    const mine = await newInterview(alice, "Mine");
    const theirs = await newInterview(mallory, "Theirs");

    const list = await listInterviews(alice);
    expect(list.map((i) => i.id)).toContain(mine.id);
    expect(list.map((i) => i.id)).not.toContain(theirs.id);
  });

  it("refuses to show an attempt to an admin who did not create the interview", async () => {
    const { attemptId } = await newAttempt(alice);

    await expect(getAttemptForAdmin(alice, attemptId)).resolves.not.toBeNull();
    await expect(getAttemptForAdmin(mallory, attemptId)).resolves.toBeNull();
  });

  /* -------------------------- shared link, many people --------------------- */

  it("lets many candidates share one link with separate attempts", async () => {
    const interview = await newInterview(alice);

    const first = await createAttempt(interview, {
      name: "First",
      email: null,
      phone: null,
    });
    const second = await createAttempt(interview, {
      name: "Second",
      email: null,
      phone: null,
    });

    expect(first.attemptId).not.toBe(second.attemptId);
    // Distinct bearer tokens are what stop one reading the other.
    expect(first.accessToken).not.toBe(second.accessToken);

    const found = await getInterviewForAdmin(alice, interview.id);
    expect(found?.attempts).toHaveLength(2);
  });

  /* ------------------------------ language probe --------------------------- */

  it("starts every attempt with an unscored language probe", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);

    const turns = await getTurns(attemptId);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.turnNumber).toBe(LANGUAGE_PROBE_TURN);
    expect(turns[0]!.kind).toBe("language_probe");
    // No skill and no score: it exists only to hear the candidate speak.
    expect(turns[0]!.skillId).toBeNull();
  });

  it("leaves the language unset until the probe is answered", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);

    const attempt = await db.query.interviewAttemptsTable.findFirst({
      where: eq(interviewAttemptsTable.id, attemptId),
    });
    expect(attempt?.language).toBeNull();
    expect(attempt?.needsLanguageChoice).toBe(false);
  });

  it("is idempotent when started twice", async () => {
    const { attemptId } = await newAttempt(alice);
    await Promise.all([startAttempt(attemptId), startAttempt(attemptId)]);

    const turns = await getTurns(attemptId);
    expect(turns).toHaveLength(1);
  });

  it("puts the skill questions after the probe", () => {
    expect(skillForAttemptTurn(1, 10)).toBeNull();
    expect(skillForAttemptTurn(2, 10)?.id).toBe("reliability");
    expect(skillForAttemptTurn(11, 10)?.id).toBe("customer_orientation");
  });

  /* ------------------------------ turn claiming ---------------------------- */

  it("processes a turn once even when submitted twice", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);
    const attempt = (await db.query.interviewAttemptsTable.findFirst({
      where: eq(interviewAttemptsTable.id, attemptId),
    }))!;

    const first = await submitAnswer({
      attempt,
      turnNumber: 1,
      audio: fakeAudio,
      mimeType: "audio/webm",
    });
    const second = await submitAnswer({
      attempt,
      turnNumber: 1,
      audio: fakeAudio,
      mimeType: "audio/webm",
    });

    expect(first.status).toBe("processing");
    expect(second.status).toBe("already_processing");
    expect(second.turnId).toBe(first.turnId);
  });

  it("survives concurrent submissions of the same turn", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);
    const attempt = (await db.query.interviewAttemptsTable.findFirst({
      where: eq(interviewAttemptsTable.id, attemptId),
    }))!;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        submitAnswer({
          attempt,
          turnNumber: 1,
          audio: fakeAudio,
          mimeType: "audio/webm",
        }),
      ),
    );

    expect(results.filter((r) => r.status === "processing")).toHaveLength(1);
  });

  it("rejects an answer for a turn that is not the active one", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);
    const attempt = (await db.query.interviewAttemptsTable.findFirst({
      where: eq(interviewAttemptsTable.id, attemptId),
    }))!;

    await expect(
      submitAnswer({
        attempt,
        turnNumber: 5,
        audio: fakeAudio,
        mimeType: "audio/webm",
      }),
    ).rejects.toBeInstanceOf(AttemptError);
  });

  it("rejects an answer once the attempt is complete", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);
    await db
      .update(interviewAttemptsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(interviewAttemptsTable.id, attemptId));

    const attempt = (await db.query.interviewAttemptsTable.findFirst({
      where: eq(interviewAttemptsTable.id, attemptId),
    }))!;

    await expect(
      submitAnswer({
        attempt,
        turnNumber: 1,
        audio: fakeAudio,
        mimeType: "audio/webm",
      }),
    ).rejects.toBeInstanceOf(AttemptError);
  });

  /* -------------------------------- reporting ------------------------------ */

  it("reports all ten skills, marking unassessed ones as null", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);

    const scores = aggregateSkillScores(await getTurns(attemptId));
    expect(scores).toHaveLength(10);
    // The probe must not appear as a skill.
    expect(scores.every((s) => s.score === null)).toBe(true);
  });

  it("does not count the probe as an answered skill question", async () => {
    const { attemptId } = await newAttempt(alice);
    await startAttempt(attemptId);

    await db
      .update(interviewTurnsTable)
      .set({ status: "completed", answerTranscript: "hello" })
      .where(eq(interviewTurnsTable.attemptId, attemptId));

    const scores = aggregateSkillScores(await getTurns(attemptId));
    expect(scores.every((s) => s.score === null)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                                   Accounts                                 */
/* -------------------------------------------------------------------------- */

describe.skipIf(!hasDb)("admin accounts", () => {
  const created: string[] = [];

  afterAll(async () => {
    if (created.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, created));
    }
  });

  it("stores a verifiable password hash and defaults to the admin role", async () => {
    const email = `seed+${Date.now()}@test.local`;
    const [row] = await db
      .insert(usersTable)
      .values({ email, passwordHash: await hashPassword("correct horse 12") })
      .returning({
        id: usersTable.id,
        passwordHash: usersTable.passwordHash,
        role: usersTable.role,
      });

    created.push(row!.id);
    expect(row!.role).toBe("admin");
    expect(row!.passwordHash).not.toContain("correct horse 12");
    await expect(
      verifyPassword(row!.passwordHash, "correct horse 12"),
    ).resolves.toBe(true);
  });

  it("rejects a duplicate email at the database level", async () => {
    const email = `dupe+${Date.now()}@test.local`;
    const passwordHash = await hashPassword("password12345");

    const [first] = await db
      .insert(usersTable)
      .values({ email, passwordHash })
      .returning({ id: usersTable.id });
    created.push(first!.id);

    let caught: unknown;
    try {
      await db.insert(usersTable).values({ email, passwordHash });
    } catch (error) {
      caught = error;
    }
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("issues a valid session that hides the password hash", async () => {
    const email = `session+${Date.now()}@test.local`;
    const [row] = await db
      .insert(usersTable)
      .values({ email, passwordHash: await hashPassword("password12345") })
      .returning({ id: usersTable.id });
    created.push(row!.id);

    const session = await lucia.createSession(row!.id, {});
    const validated = await lucia.validateSession(session.id);

    expect(validated.user?.id).toBe(row!.id);
    expect(validated.user).not.toHaveProperty("passwordHash");

    await lucia.invalidateSession(session.id);
    await expect(
      lucia.validateSession(session.id).then((r) => r.user),
    ).resolves.toBeNull();
  });

  it("lowercases emails through the login schema", () => {
    const parsed = loginSchema.parse({
      email: "  Person@Example.COM ",
      password: "password12345",
    });
    expect(parsed.email).toBe("person@example.com");
  });
});
