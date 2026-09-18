CREATE TYPE "public"."preparation_status" AS ENUM('pending', 'questions_ready', 'audio_ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."turn_variant_role" AS ENUM('primary', 'easier', 'probe');--> statement-breakpoint
CREATE TYPE "public"."variant_audio_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."turn_kind" ADD VALUE 'comfort' BEFORE 'skill';--> statement-breakpoint
CREATE TABLE "interview_turn_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"turn_number" smallint NOT NULL,
	"role" "turn_variant_role" NOT NULL,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"translation" text,
	"audio_id" uuid,
	"audio_status" "variant_audio_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "preparation_status" "preparation_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_attempts" ADD COLUMN "preparation_error" text;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "follow_ups_asked" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "add_more_prompted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "silence_stage" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "directive_seq" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_turn_variants" ADD CONSTRAINT "interview_turn_variants_attempt_id_interview_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."interview_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_turn_variants_queue_idx" ON "interview_turn_variants" USING btree ("attempt_id","audio_status");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_variants_unique_idx" ON "interview_turn_variants" USING btree ("attempt_id","turn_number","role","ordinal");