DROP INDEX "interview_turn_variants_unique_idx";--> statement-breakpoint
ALTER TABLE "interview_turn_variants" ADD COLUMN "plan_index" smallint NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_variants_unique_idx" ON "interview_turn_variants" USING btree ("attempt_id","plan_index","role","ordinal");