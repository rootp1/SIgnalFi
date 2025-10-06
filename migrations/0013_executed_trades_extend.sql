-- 0013_executed_trades_extend.sql
-- Phase 3: extend executed_trades with integrity & planning fields.
ALTER TABLE executed_trades ADD COLUMN IF NOT EXISTS intent_hash TEXT;
ALTER TABLE executed_trades ADD COLUMN IF NOT EXISTS anchor_id BIGINT;
ALTER TABLE executed_trades ADD COLUMN IF NOT EXISTS payload_hash TEXT;
ALTER TABLE executed_trades ADD COLUMN IF NOT EXISTS plan_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_executed_trades_intent_hash ON executed_trades(intent_hash);
CREATE INDEX IF NOT EXISTS idx_executed_trades_anchor_id ON executed_trades(anchor_id);
