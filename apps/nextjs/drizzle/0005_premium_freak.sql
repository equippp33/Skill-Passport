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
