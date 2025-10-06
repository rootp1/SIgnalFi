-- 0014_executed_trades_followers.sql
-- Phase 4: store follower snapshot for allocation integrity.
ALTER TABLE executed_trades ADD COLUMN IF NOT EXISTS followers_snapshot JSONB;
CREATE INDEX IF NOT EXISTS idx_executed_trades_followers_snapshot ON executed_trades USING gin (followers_snapshot);
