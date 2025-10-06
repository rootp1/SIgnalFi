-- 0003_delivery_queue.sql
-- Adds queue/worker support for signal deliveries.
ALTER TABLE signal_deliveries ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
ALTER TABLE signal_deliveries ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE signal_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_signal_deliveries_status ON signal_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_signal_deliveries_next_attempt ON signal_deliveries(next_attempt_at);
