CREATE TYPE "public"."turn_directive_action" AS ENUM('replay', 'play_easier', 'play_probe', 'play_filler', 'advance');--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "directive_action" "turn_directive_action";--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "directive_audio_id" uuid;