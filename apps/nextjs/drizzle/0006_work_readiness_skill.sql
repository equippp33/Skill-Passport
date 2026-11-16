-- Adds the Work Readiness skill to the work_skill enum.
--
-- Additive only: ADD VALUE never rewrites, drops or touches existing rows.
-- IF NOT EXISTS makes it a no-op on databases that already have the value
-- (it was applied out-of-band to the existing environments), and adds it on a
-- fresh database, where nothing earlier in the journal creates it.
ALTER TYPE "public"."work_skill" ADD VALUE IF NOT EXISTS 'work_readiness' BEFORE 'reliability';
