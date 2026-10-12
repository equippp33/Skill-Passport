-- `external_student_id` and `result_delivered_at` already exist on deployed
-- databases; they appear here only because the snapshot had drifted. Every
-- statement is IF NOT EXISTS so this is a no-op where they are present and
-- still correct on a fresh database.
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "external_student_id" text;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "summary_translated" text;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "strengths_translated" text[];--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "improvements_translated" text[];--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "report_language" text;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "result_delivered_at" timestamp with time zone;--> statement-breakpoint
-- Model tokens, counted per provider rather than in one pair of columns: the
-- same token costs about six times more at OpenAI than at Sarvam, and the
-- circuit breaker moves work between them mid-interview. The existing `llm_*`
-- columns are the OpenAI side and keep their names — every token ever written
-- to them came from the OpenAI client, which was the only caller of
-- `recordUsage` — so no backfill is needed and the history reads correctly.
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "sarvam_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "sarvam_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "sarvam_output_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- The per-question evaluation in the candidate's own language. `evaluation`
-- itself stays English for reviewers; this is the copy the candidate can read.
ALTER TABLE "interview_turns" ADD COLUMN IF NOT EXISTS "evaluation_translated" text;
--> statement-breakpoint
-- Other skills a single answer also gave evidence of. Lets a skill be judged
-- from every answer that demonstrated it, not only the one question that
-- named it. See `aggregateSkillScores`.
ALTER TABLE "interview_turns" ADD COLUMN IF NOT EXISTS "secondary_skills" jsonb;
--> statement-breakpoint
-- What a report said before a re-score replaced it. Version 1 is the original
-- scoring; the live attempt row is always the latest. See `rescoreAttempt`.
CREATE TABLE IF NOT EXISTS "attempt_score_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attempt_id" uuid NOT NULL REFERENCES "interview_attempts"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "overall_score" integer,
  "summary" text,
  "strengths" text[],
  "improvements" text[],
  "skill_scores" jsonb,
  "turn_scores" jsonb,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attempt_score_snapshots_attempt_idx" ON "attempt_score_snapshots" ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attempt_score_snapshots_version_idx" ON "attempt_score_snapshots" ("attempt_id","version");
