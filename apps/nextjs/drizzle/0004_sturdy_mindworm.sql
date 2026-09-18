ALTER TABLE "interview_attempts" ADD COLUMN "stt_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "stt_audio_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "tts_characters" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "llm_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "llm_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "llm_output_tokens" integer DEFAULT 0 NOT NULL;