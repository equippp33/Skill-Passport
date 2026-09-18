DROP INDEX "interview_turn_variants_unique_idx";--> statement-breakpoint
ALTER TABLE "interview_turns" ADD COLUMN "plan_index" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_variants_unique_idx" ON "interview_turn_variants" USING btree ("attempt_id","role","ordinal");--> statement-breakpoint
ALTER TABLE "interview_turn_variants" DROP COLUMN "turn_number";