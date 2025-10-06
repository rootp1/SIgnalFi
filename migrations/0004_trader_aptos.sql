-- 0004_trader_aptos.sql
-- Adds Aptos on-chain integration fields for traders and anchoring support.
ALTER TABLE traders ADD COLUMN IF NOT EXISTS aptos_address TEXT UNIQUE;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS onchain_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS last_onchain_seq BIGINT;
CREATE TABLE IF NOT EXISTS anchored_signals (
  id BIGSERIAL PRIMARY KEY,
  signal_id BIGINT REFERENCES signals(id) ON DELETE CASCADE,
  seq BIGINT,
  tx_hash TEXT,
  status TEXT DEFAULT 'pending', -- pending | anchored | failed
  created_at TIMESTAMPTZ DEFAULT NOW()
);