-- 0011_executed_trades.sql
-- Phase 2: executed_trades table to track processing of trade intents (simulation placeholder pre-vault integration).
CREATE TABLE IF NOT EXISTS executed_trades (
  id BIGSERIAL PRIMARY KEY,
  trade_intent_id BIGINT REFERENCES trade_intents(id) ON DELETE CASCADE,
  signal_id BIGINT REFERENCES signals(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | simulated | executed | failed
  tx_hash TEXT,
  size_value NUMERIC, -- copy of intent.size_value at execution
  slippage_bps INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_executed_trades_intent ON executed_trades(trade_intent_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_status ON executed_trades(status);
