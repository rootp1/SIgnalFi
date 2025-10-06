-- 0006_anchor_retry.sql
-- Adds retry/backoff fields to anchored_signals and supporting indexes
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_anchored_signals_status_next_attempt ON anchored_signals(status, next_attempt_at);
