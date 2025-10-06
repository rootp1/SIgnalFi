-- Idempotent finalization of the 'attempts' column. Safe to re-run.
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS attempts INTEGER;
ALTER TABLE anchored_signals ALTER COLUMN attempts SET DEFAULT 0;
UPDATE anchored_signals SET attempts = 0 WHERE attempts IS NULL;
ALTER TABLE anchored_signals ALTER COLUMN attempts SET NOT NULL;
-- Finished.