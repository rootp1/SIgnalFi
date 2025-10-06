-- 0007_anchor_retry_fix.sql
-- Idempotent reconciliation of retry/backoff columns on anchored_signals.
-- Handles cases where 0006 partially applied (some columns exist, others missing) causing duplicate column errors.
-- Fallback simple idempotent statements (no DO block to avoid migration splitter issues)
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE anchored_signals ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_anchored_signals_status_next_attempt ON anchored_signals(status, next_attempt_at);
