-- 0012_trade_intents_pending_exec_fn.sql
-- RPC helper to list trade_intents lacking executed_trades row.
DROP FUNCTION IF EXISTS trade_intents_pending_exec();
CREATE FUNCTION trade_intents_pending_exec()
RETURNS TABLE (
  id BIGINT,
  signal_id BIGINT,
  action TEXT,
  market TEXT,
  size_mode TEXT,
  size_value NUMERIC,
  max_slippage_bps INTEGER,
  deadline_ts BIGINT
) AS '
  SELECT ti.id, ti.signal_id, ti.action, ti.market, ti.size_mode, ti.size_value, ti.max_slippage_bps, ti.deadline_ts
  FROM trade_intents ti
  LEFT JOIN executed_trades et ON et.trade_intent_id = ti.id
  WHERE et.id IS NULL
  ORDER BY ti.id ASC
  LIMIT 50;
' LANGUAGE sql STABLE;
