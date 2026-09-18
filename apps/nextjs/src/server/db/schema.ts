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
 * whose only job is to hear the candidate speak. `comfort` turns are the easy
 * openers that follow it — also unscored, and there to settle a nervous
 * candidate before anything counts. Only `skill` turns are assessed.
 *
 * `comfort` is deliberately NOT `skill`: the schedule counts skill turns to
 * decide what to ask next (`nextPrimarySkill`), so a comfort question filed
 * as a skill would silently eat one of the ten.
 */
export const turnKindEnum = pgEnum("turn_kind", [
  "language_probe",
  "comfort",
  "skill",
]);

/**
 * Which job a prepared string does.
 *
 * `primary` is the question itself; `easier` is the same question restated for
 * someone who did not follow it; `probe` is a follow-up that can be asked
 * whatever the candidate said. `filler` is one of the fixed lines — "okay",
 * "take your time" — which belong to the attempt rather than to any one
 * question, and are filed under plan index 0.
 *
 * Fillers are stored per attempt rather than shared across all of them, even
 * though the text is identical everywhere. Sharing would mean clips with no
 * owning attempt, and the media route authorises playback by asking whether
 * this clip belongs to this attempt — the one rule that stops a candidate
 * reading another's recordings. Eight short clips per interview is a small
 * price for not weakening it.
 */
export const turnVariantRoleEnum = pgEnum("turn_variant_role", [
  "primary",
  "easier",
  "probe",
  "filler",
]);

/** Whether a prepared string has been voiced yet. */
export const variantAudioStatusEnum = pgEnum("variant_audio_status", [
  "pending",
  "ready",
  "failed",
]);

/**
 * What the browser should do next for the current turn.
 *
 * `replay` says the question again; `play_easier` says the prepared simpler
 * wording; `play_probe` asks a prepared follow-up; `play_filler` says a short
 * fixed line ("take your time", "okay") without changing the question; and
 * `advance` moves on without saying anything more.
 */
export const turnDirectiveActionEnum = pgEnum("turn_directive_action", [
  "replay",
  "play_easier",
  "play_probe",
  "play_filler",
  "advance",
]);

/**
 * Whether an answer was something other than an attempt at the question.
 *
 * `none` is overwhelmingly the common case. `off_topic` is chit-chat or a
 * question put back to the interviewer. `inappropriate` is abuse, or anything
 * a human reviewer would want to see before reading a score.
 *
 * Judged by the model that already scores the turn, so it costs no extra call
 * and no extra wait — and unlike a word list it catches things nobody thought
 * to list. It is a flag for a person, never an automatic decision: the
 * interview carries on either way.
 */
export const turnConcernEnum = pgEnum("turn_concern", [
  "none",
  "off_topic",
  "inappropriate",
]);

/** How far the up-front preparation of an interview has got. */
export const preparationStatusEnum = pgEnum("preparation_status", [
  "pending",
  "questions_ready",
  "audio_ready",
  "failed",
]);

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
     * Skills the admin allowed a follow-up on. For a skill in this list the
     * model may ask one extra "dig deeper" question when the answer warrants
     * it; skills not listed never get a follow-up. Empty = none (the default).
     */
    followUpSkills: workSkillEnum("follow_up_skills")
      .array()
      .notNull()
      .default([]),

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
     * What the candidate typed about themselves before starting: studying or
     * working, where, doing what.
     *
     * Collected alongside the language choice rather than drawn out of the
     * first spoken answer, so the very first question can already be about
     * their actual life. Without it question one is asked into a vacuum and
     * only the questions after it benefit from knowing anything.
     *
     * Untrusted free text — it reaches the model wrapped, like any transcript.
     */
    candidateBackground: text("candidate_background"),

    /**
     * What they are studying or training in, and what work they have done
     * before — asked as two questions rather than one open box.
     *
     * Structured because the two answer different things: the course says
     * what world to set a scenario in, the experience says whether they have
     * ever had a manager, a shift or a customer. One free-text box got
     * whichever the candidate thought to mention, and usually not both.
     *
     * `candidateBackground` above is kept and still written, composed from
     * these, so every existing report and prompt path keeps working without a
     * data migration.
     */
    candidateCourse: text("candidate_course"),
    candidateExperience: text("candidate_experience"),

    /**
     * Speaking rate for this interview, 1.0 being the interviewer's natural
     * pace.
     *
     * Set when a candidate asks for it slower. Applied in the browser with
     * `playbackRate`, which is what makes it work retroactively: clips voiced
     * before they asked slow down too, where re-synthesising would only fix
     * the next one. Persisted so a reload does not lose it.
     */
    speechRate: real("speech_rate").notNull().default(1),

    /**
     * How far the up-front question preparation has got.
     *
     * Stored rather than inferred so preparation is resumable: a deploy or a
     * crash mid-wave otherwise orphans the work with nothing to notice it,
     * and the candidate walks into a question that was never written.
     */
    preparationStatus: preparationStatusEnum("preparation_status")
      .notNull()
      .default("pending"),
    preparationError: text("preparation_error"),

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

    /**
     * What this interview cost to run, accumulated as it runs.
     *
     * Every provider is billed on a different unit, so each is stored in the
     * unit it is actually billed in rather than normalised into one number
     * here: TTS per character, the models per token, STT per request and the
     * bytes sent. Prices change and differ per account, so the arithmetic
     * belongs wherever someone is doing the costing, not baked into a column.
     *
     * Incremented in SQL (`x = x + n`) rather than read-modify-written, so
     * the concurrent legs of one turn cannot lose each other's counts.
     */
    sttRequests: integer("stt_requests").notNull().default(0),
    sttAudioBytes: integer("stt_audio_bytes").notNull().default(0),
    ttsCharacters: integer("tts_characters").notNull().default(0),
    llmRequests: integer("llm_requests").notNull().default(0),
    llmInputTokens: integer("llm_input_tokens").notNull().default(0),
    llmOutputTokens: integer("llm_output_tokens").notNull().default(0),

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

    /**
     * When the browser said it was closing, if it managed to.
     *
     * Sent as a beacon on the way out, which is the only moment we can learn
     * this directly — after that the tab is gone and the server can only infer
     * it from missing heartbeats, which takes minutes and leaves the interview
     * showing as running the whole time.
     *
     * Cleared by the next heartbeat, so a reload or a restored tab undoes it.
     * That is what makes it safe to act on quickly: a candidate who comes
     * straight back is still here, and only somebody who really left stays
     * left.
     */
    leftAt: timestamp("left_at", { withTimezone: true }),

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

    /**
     * How many follow-up probes this question has already spent, capped at
     * two. Incremented in SQL rather than read-modify-written, like every
     * other counter here.
     */
    followUpsAsked: smallint("follow_ups_asked").notNull().default(0),

    /**
     * When the candidate was asked whether they wanted to add anything.
     *
     * A timestamp rather than a boolean: `IS NULL` reads the same, and when
     * an interview goes strangely it is far more useful to know *when* than
     * merely that it happened.
     */
    addMorePromptedAt: timestamp("add_more_prompted_at", {
      withTimezone: true,
    }),

    /**
     * How far up the 7s / 15s / 30s silence ladder this turn has climbed.
     * Persisted so a reload does not drop the candidate back to the bottom.
     */
    silenceStage: smallint("silence_stage").notNull().default(0),

    /**
     * Bumped every time the server has something new for the browser to play.
     *
     * The client polls once a second and will therefore see the same
     * instruction many times; it acts when this number changes. Without it
     * "replay the question" and "play the easier version" are
     * indistinguishable, because both leave the turn number and status
     * exactly as they were.
     */
    directiveSeq: smallint("directive_seq").notNull().default(0),

    /**
     * The instruction itself, and the clip it refers to.
     *
     * Null between instructions, which is the ordinary state of a turn the
     * candidate is simply answering.
     */
    directiveAction: turnDirectiveActionEnum("directive_action"),
    directiveAudioId: uuid("directive_audio_id"),

    /**
     * Which entry of the prepared plan this turn was delivered from.
     *
     * The link back to `interview_turn_variants`, and therefore to this
     * question's simpler wording and its probes. Null on the opening turn,
     * whose text is fixed rather than prepared, and on a follow-up, which
     * borrows its parent's plan entry.
     */
    planIndex: smallint("plan_index"),

    /**
     * Whether this answer was an attempt at the question at all. See
     * `turnConcernEnum`. Shown to the admin; never acted on automatically.
     */
    concern: turnConcernEnum("concern").notNull().default("none"),

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

/**
 * Every string the interviewer might say for a given turn, written and voiced
 * before the candidate gets there.
 *
 * A turn now has more than one thing it can say — the question, a simpler
 * restatement, and up to two follow-up probes — and each needs its own audio
 * clip. They live here rather than as columns on `interview_turns` for three
 * reasons: the turn row is read on every one-second poll and does not need to
 * carry four more strings; "up to two probes" becomes a migration the day it
 * becomes three; and the concurrent voicing of several variants of one turn
 * would be lost-update-prone against a single jsonb column, which this schema
 * avoids everywhere it matters.
 *
 * The `(attemptId, audioStatus)` index is the point: it is the work queue the
 * background voicer reads.
 */
export const interviewTurnVariantsTable = pgTable(
  "interview_turn_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => interviewAttemptsTable.id, { onDelete: "cascade" }),

    /**
     * Position in the prepared plan — 1, 2, 3 in the order questions will be
     * asked.
     *
     * Deliberately NOT the turn number. A follow-up is inserted between two
     * planned questions and shifts every turn number after it, so a plan keyed
     * on turn numbers would misfile itself the first time anyone was probed.
     * `interview_turns.plan_index` records which plan entry a delivered turn
     * came from.
     */
    planIndex: smallint("plan_index").notNull(),
    role: turnVariantRoleEnum("role").notNull(),
    /**
     * Which fixed line this is — `okay`, `whatHappened`, `addMore` and so on.
     *
     * Empty for everything that is not a filler, where the plan index and role
     * already identify the row. Empty rather than null because it is part of
     * the unique index below, and Postgres treats nulls there as distinct from
     * each other — which would let the same prepared question be inserted
     * twice, the exact thing that index exists to prevent.
     */
    slug: text("slug").notNull().default(""),
    /** Distinguishes the two probes. Always 0 for `primary` and `easier`. */
    ordinal: smallint("ordinal").notNull().default(0),

    text: text("text").notNull(),
    /** English rendering, for the reviewer. Null when already English. */
    translation: text("translation"),

    audioId: uuid("audio_id"),
    audioStatus: variantAudioStatusEnum("audio_status")
      .notNull()
      .default("pending"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The voicer's queue: "what still needs audio for this attempt".
    index("interview_turn_variants_queue_idx").on(t.attemptId, t.audioStatus),
    /**
     * One row per role per plan entry, so a retried wave cannot double up.
     *
     * `slug` is part of the key, and has to be: every fixed line shares plan
     * index 0 and role `filler`, and their ordinals each start at zero. Without
     * it, `okay` #0 and `addMore` #0 collide, and the `onConflictDoNothing` that
     * makes a retried wave safe silently threw away every kind but the first —
     * so an interview had five ways to say "okay" and no way to say anything
     * else, including the lines the silence ladder depends on.
     *
     * Questions carry an empty slug rather than a null one, so they still
     * de-duplicate normally — see the column.
     */
    uniqueIndex("interview_turn_variants_unique_idx").on(
      t.attemptId,
      t.planIndex,
      t.role,
      t.ordinal,
      t.slug,
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
    /**
     * How long the clip runs, as measured while recording.
     *
     * Taken from the recorder rather than read back out of the container:
     * MediaRecorder WebM is written without a duration header, so a browser
     * reports it as `Infinity` until the whole file has been played through.
     * Nullable — clips predating this, and question audio, have none.
     */
    durationMs: integer("duration_ms"),
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
export type InterviewTurnVariant =
  typeof interviewTurnVariantsTable.$inferSelect;
