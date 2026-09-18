ALTER TYPE "public"."turn_variant_role" ADD VALUE 'filler';--> statement-breakpoint
ALTER TABLE "interview_turn_variants" ADD COLUMN "slug" text;