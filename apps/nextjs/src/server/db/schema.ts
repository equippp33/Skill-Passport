import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/*                                    Auth                                    */
/* -------------------------------------------------------------------------- */

/**
 * Only staff have Lucia accounts. Candidates are never users — they reach an
 * interview through an unguessable link and are identified by an attempt
 * token, so there is no signup path into the admin side.
 */
export const userRoleEnum = pgEnum("user_role", ["admin"]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    role: userRoleEnum("role").notNull().default("admin"),
    /** Set on the seeded account; blocks production use until rotated. */
    mustChangePassword: boolean("must_change_password")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique_idx").on(t.email)],
);

/** Shape required by `@lucia-auth/adapter-drizzle`. */
export const sessionsTable = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/* -------------------------------------------------------------------------- */
/*                                   Shared                                   */
/* -------------------------------------------------------------------------- */

export const attemptStatusEnum = pgEnum("attempt_status", [
  "not_started",
  "in_progress",
  "processing",
  "completed",
  "failed",
]);

export const interviewTurnStatusEnum = pgEnum("interview_turn_status", [
  "awaiting_answer",
  "processing",
  "completed",
  "failed",
]);

/**
 * Turn 1 of every attempt is a language probe: a neutral, unscored opener
 * whose only job is to hear the candidate speak so Sarvam can identify their
 * language. Turns 2+ are the scored skill questions.
 */
export const turnKindEnum = pgEnum("turn_kind", ["language_probe", "skill"]);

/** Mirrors WORK_SKILL_IDS in `~/config/work-skills`. */
export const workSkillEnum = pgEnum("work_skill", [
  "reliability",
  "responsibility",
  "following_instructions",
  "attention_to_detail",
  "communication",
  "teamwork",
  "problem_solving",
  "learning_adaptability",
  "initiative",
  "customer_orientation",
]);

export const interviewAudioKindEnum = pgEnum("interview_audio_kind", [
  "question",
  "answer",
  "answer_video",
]);

/* -------------------------------------------------------------------------- */
/*                          Interviews (admin-owned)                          */
/* -------------------------------------------------------------------------- */

/**
 * An interview an admin created and shares as a link. It is a template, not a
 * sitting: any number of candidates can open the same link, and each of them
 * gets their own row in `interview_attempts`.
 */
export const interviewsTable = pgTable(
  "interviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    /** Shown to the candidate on the landing page. */
    description: text("description"),
    questionCount: smallint("question_count").notNull(),

    /**
     * The unguessable half of the share link. Never a sequential id — the
     * link is the only thing standing between the public and this interview.
     */
    publicToken: text("public_token").notNull(),
    /** Closed interviews reject new attempts but keep existing results. */
    isOpen: boolean("is_open").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("interviews_public_token_unique_idx").on(t.publicToken),
    index("interviews_created_by_idx").on(t.createdByUserId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                       Attempts (one per candidate)                         */
/* -------------------------------------------------------------------------- */

export const interviewAttemptsTable = pgTable(
  "interview_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviewsTable.id, { onDelete: "cascade" }),

    /**
     * Bearer token for this attempt, held in an httpOnly cookie. Candidates
     * have no account, so this is what stops one candidate opening another's
     * attempt by editing the URL.
     */
    accessToken: text("access_token").notNull(),

    candidateName: text("candidate_name").notNull(),
    candidateEmail: text("candidate_email"),
    candidatePhone: text("candidate_phone"),

    /**
     * Detected from the candidate's first spoken answer, then used for every
     * later question, STT, TTS, evaluation and the report. Null until the
     * language probe has been answered.
     */
    language: text("language"),
    /** Confidence Sarvam reported when the language was set. */
    languageConfidence: real("language_confidence"),
    /**
     * Set when detection was unusable — unsupported language or low
     * confidence. The candidate is asked to choose rather than being guessed
     * at, and this clears once they do.
     */
    needsLanguageChoice: boolean("needs_language_choice")
      .notNull()
      .default(false),

    status: attemptStatusEnum("status").notNull().default("not_started"),
    currentQuestionNumber: smallint("current_question_number")
      .notNull()
      .default(0),

    overallScore: smallint("overall_score"),
    summary: text("summary"),
    strengths: text("strengths").array(),
    improvements: text("improvements").array(),
    errorMessage: text("error_message"),

    /** Times the candidate left the tab, as a light proctoring signal. */
    awayCount: smallint("away_count").notNull().default(0),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attempts_access_token_unique_idx").on(t.accessToken),
    index("attempts_interview_idx").on(t.interviewId),
    index("attempts_interview_status_idx").on(t.interviewId, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                   Turns                                    */
/* -------------------------------------------------------------------------- */

export const interviewTurnsTable = pgTable(
  "interview_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => interviewAttemptsTable.id, { onDelete: "cascade" }),

    turnNumber: smallint("turn_number").notNull(),
    kind: turnKindEnum("kind").notNull().default("skill"),
    /** Null on the language probe, which is not scored against a skill. */
    skillId: workSkillEnum("skill_id"),
    isFollowUp: boolean("is_follow_up").notNull().default(false),

    question: text("question").notNull(),
    questionTranslation: text("question_translation"),
    questionAudioId: uuid("question_audio_id"),

    answerTranscript: text("answer_transcript"),
    answerAudioId: uuid("answer_audio_id"),
    answerVideoId: uuid("answer_video_id"),
    /** Language Sarvam heard in this answer, used to spot a switch. */
    detectedLanguageCode: text("detected_language_code"),

    score: smallint("score"),
    evaluation: text("evaluation"),
    strengths: text("strengths").array(),
    improvements: text("improvements").array(),

    status: interviewTurnStatusEnum("status")
      .notNull()
      .default("awaiting_answer"),
    errorMessage: text("error_message"),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("interview_turns_attempt_idx").on(t.attemptId),
    // One row per turn number per attempt: the database, not the app, is what
    // ultimately prevents a duplicate turn from a double submit.
    uniqueIndex("interview_turns_attempt_turn_unique_idx").on(
      t.attemptId,
      t.turnNumber,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                   Audio                                    */
/* -------------------------------------------------------------------------- */

export const interviewAudioTable = pgTable(
  "interview_audio",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => interviewAttemptsTable.id, { onDelete: "cascade" }),
    kind: interviewAudioKindEnum("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Object key in Cloudflare R2. Bytes are never stored in Postgres. */
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("interview_audio_attempt_idx").on(t.attemptId)],
);

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(usersTable, ({ many }) => ({
  interviews: many(interviewsTable),
}));

export const interviewsRelations = relations(
  interviewsTable,
  ({ one, many }) => ({
    createdBy: one(usersTable, {
      fields: [interviewsTable.createdByUserId],
      references: [usersTable.id],
    }),
    attempts: many(interviewAttemptsTable),
  }),
);

export const interviewAttemptsRelations = relations(
  interviewAttemptsTable,
  ({ one, many }) => ({
    interview: one(interviewsTable, {
      fields: [interviewAttemptsTable.interviewId],
      references: [interviewsTable.id],
    }),
    turns: many(interviewTurnsTable),
  }),
);

export const interviewTurnsRelations = relations(
  interviewTurnsTable,
  ({ one }) => ({
    attempt: one(interviewAttemptsTable, {
      fields: [interviewTurnsTable.attemptId],
      references: [interviewAttemptsTable.id],
    }),
  }),
);

export type User = typeof usersTable.$inferSelect;
export type Interview = typeof interviewsTable.$inferSelect;
export type InterviewAttempt = typeof interviewAttemptsTable.$inferSelect;
export type InterviewTurn = typeof interviewTurnsTable.$inferSelect;
