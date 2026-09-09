CREATE TYPE "public"."attempt_status" AS ENUM('not_started', 'in_progress', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interview_audio_kind" AS ENUM('question', 'answer', 'answer_video');--> statement-breakpoint
CREATE TYPE "public"."interview_turn_status" AS ENUM('awaiting_answer', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."turn_kind" AS ENUM('language_probe', 'skill');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin');--> statement-breakpoint
CREATE TYPE "public"."work_skill" AS ENUM('reliability', 'responsibility', 'following_instructions', 'attention_to_detail', 'communication', 'teamwork', 'problem_solving', 'learning_adaptability', 'initiative', 'customer_orientation');--> statement-breakpoint
CREATE TABLE "interview_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_email" text,
	"candidate_phone" text,
	"language" text,
	"language_confidence" real,
	"needs_language_choice" boolean DEFAULT false NOT NULL,
	"status" "attempt_status" DEFAULT 'not_started' NOT NULL,
	"current_question_number" smallint DEFAULT 0 NOT NULL,
	"overall_score" smallint,
	"summary" text,
	"strengths" text[],
	"improvements" text[],
	"error_message" text,
	"away_count" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_audio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"kind" "interview_audio_kind" NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"turn_number" smallint NOT NULL,
	"kind" "turn_kind" DEFAULT 'skill' NOT NULL,
	"skill_id" "work_skill",
	"is_follow_up" boolean DEFAULT false NOT NULL,
	"question" text NOT NULL,
	"question_translation" text,
	"question_audio_id" uuid,
	"answer_transcript" text,
	"answer_audio_id" uuid,
	"answer_video_id" uuid,
	"detected_language_code" text,
	"score" smallint,
	"evaluation" text,
	"strengths" text[],
	"improvements" text[],
	"status" "interview_turn_status" DEFAULT 'awaiting_answer' NOT NULL,
	"error_message" text,
	"processing_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"question_count" smallint NOT NULL,
	"public_token" text NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'admin' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD CONSTRAINT "interview_attempts_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_audio" ADD CONSTRAINT "interview_audio_attempt_id_interview_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."interview_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_attempt_id_interview_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."interview_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_access_token_unique_idx" ON "interview_attempts" USING btree ("access_token");--> statement-breakpoint
CREATE INDEX "attempts_interview_idx" ON "interview_attempts" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "attempts_interview_status_idx" ON "interview_attempts" USING btree ("interview_id","status");--> statement-breakpoint
CREATE INDEX "interview_audio_attempt_idx" ON "interview_audio" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "interview_turns_attempt_idx" ON "interview_turns" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_attempt_turn_unique_idx" ON "interview_turns" USING btree ("attempt_id","turn_number");--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_public_token_unique_idx" ON "interviews" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "interviews_created_by_idx" ON "interviews" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_idx" ON "users" USING btree ("email");