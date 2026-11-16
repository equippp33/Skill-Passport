-- Counts characters sent to Sarvam's transliterate API, so the cost readout
-- can price them (they were not metered before).
--
-- Additive only: a new column with a default of 0. Existing rows keep every
-- value they have; IF NOT EXISTS makes a re-run a no-op.
--
-- The generated snapshot for this migration also includes
-- `attempt_score_snapshots`, which 0005 already creates by hand but which had
-- never made it into a snapshot. Nothing is created for it here.
ALTER TABLE "interview_attempts" ADD COLUMN IF NOT EXISTS "transliteration_characters" integer DEFAULT 0 NOT NULL;
