-- These columns already exist in this database (applied out-of-band), so every
-- statement is written IF NOT EXISTS: a no-op here, correct on a fresh database.
-- The work_readiness enum value is covered by 0004_work_readiness_skill.sql.
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "tts_characters" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "llm_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "llm_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "llm_output_tokens" integer DEFAULT 0 NOT NULL;