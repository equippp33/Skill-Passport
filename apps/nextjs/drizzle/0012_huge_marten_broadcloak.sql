CREATE TYPE "public"."turn_concern" AS ENUM('none', 'off_topic', 'inappropriate');--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "concern" "turn_concern" DEFAULT 'none' NOT NULL;