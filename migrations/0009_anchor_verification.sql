-- 0009_anchor_verification.sql
-- Adds verification metadata columns to anchored_signals.
-- Purpose: store when an anchor was cryptographically verified via on-chain tx event matching.
ALTER TABLE anchored_signals ADD COLUMN verified_at TIMESTAMPTZ;
ALTER TABLE anchored_signals ADD COLUMN verification_status TEXT DEFAULT 'unverified';

CREATE INDEX IF NOT EXISTS idx_anchored_signals_verification_status ON anchored_signals(verification_status);
CREATE INDEX IF NOT EXISTS idx_anchored_signals_verified_at ON anchored_signals(verified_at);
