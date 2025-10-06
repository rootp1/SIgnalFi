-- 0005_anchor_hash.sql
-- Add payload hash column to anchored_signals and index for quick lookups.
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS payload_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_anchored_signals_hash ON anchored_signals(payload_hash);
