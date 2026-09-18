DROP INDEX "interview_turn_variants_unique_idx";--> statement-breakpoint
-- Existing question rows carry a null slug; the column is about to become
-- NOT NULL, so give them the empty value the default will hand out.
UPDATE "interview_turn_variants" SET "slug" = '' WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "interview_turn_variants" ALTER COLUMN "slug" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "interview_turn_variants" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_variants_unique_idx" ON "interview_turn_variants" USING btree ("attempt_id","plan_index","role","ordinal","slug");