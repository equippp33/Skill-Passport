ALTER TABLE "interview_attempts" ADD COLUMN "candidate_course" text;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "candidate_experience" text;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "speech_rate" real DEFAULT 1 NOT NULL;