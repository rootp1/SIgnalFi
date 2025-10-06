import { getSupabase } from './supabaseClient';
import { logger } from './logger';
import { hashPayload } from './hash';

const INTERVAL = Number(process.env.TRADE_EXECUTOR_INTERVAL_MS || 15000);

export function startTradeExecutorWorker() {
  setInterval(processTradeIntents, INTERVAL).unref();
  logger.info({ interval: INTERVAL }, 'trade.executor.started');
}

async function processTradeIntents() {
  const supabase = getSupabase();
  // Fetch intents + anchor verification status
  const { data, error } = await supabase
    .from('trade_intents')
    .select('id, signal_id, action, market, size_mode, size_value, max_slippage_bps, deadline_ts, intent_hash, executed:executed_trades(id), anchor:anchored_signals(id, signal_id, verification_status, payload_hash)')
    .limit(50);
  if (error) { logger.error({ err: error }, 'trade.intent.fetch.error'); return; }
  if (!data || !data.length) return;
  for (const intent of data as any[]) {
    if (intent.executed && intent.executed.length) continue; // already has an execution row
    const anchor = intent.anchor && intent.anchor.find ? intent.anchor.find((a: any) => a.signal_id === intent.signal_id) : (Array.isArray(intent.anchor) ? intent.anchor[0] : intent.anchor);
    if (!anchor || anchor.verification_status !== 'verified') continue; // gate on verified anchor
    await createExecutionRow(intent, anchor).catch((e: any) => logger.error({ id: intent.id, err: e }, 'trade.exec.row.create.error'));
  }
  // Now process newly created pending rows
  const { data: execRows, error: execErr } = await supabase
    .from('executed_trades')
    .select('id, trade_intent_id, signal_id, status')
    .eq('status', 'pending')
    .limit(25);
  if (execErr) { logger.error({ err: execErr }, 'trade.exec.fetch.error'); return; }
  for (const row of execRows || []) {
    await simulateExecution(row).catch(e => logger.error({ id: row.id, err: e }, 'trade.exec.simulate.error'));
  }
}

async function simulateExecution(row: any) {
  const supabase = getSupabase();
  const { data: intentRow, error } = await supabase
    .from('trade_intents')
    .select('intent_hash, size_value')
    .eq('id', row.trade_intent_id)
    .maybeSingle();
  if (error || !intentRow) {
    await supabase.from('executed_trades').update({ status: 'failed', error: 'INTENT_NOT_FOUND' }).eq('id', row.id);
    return;
  }
  const pseudoTx = '0xSIM_' + intentRow.intent_hash.slice(0, 24);
  const { error: upErr } = await supabase
    .from('executed_trades')
    .update({ status: 'simulated', tx_hash: pseudoTx, executed_at: new Date().toISOString() })
    .eq('id', row.id);
  if (upErr) throw upErr;
  logger.info({ id: row.id, pseudoTx }, 'trade.exec.simulated');
}

async function createExecutionRow(intent: any, anchor: any) {
  const supabase = getSupabase();
  // Snapshot follower IDs for the trader at execution creation time
  let followerRows: any[] = [];
  if (intent.signal_id) {
    const { data: sigRow } = await supabase.from('signals').select('trader_id').eq('id', intent.signal_id).maybeSingle();
    if (sigRow?.trader_id) {
      const { data: fRows } = await supabase.from('follows').select('follower_id').eq('trader_id', sigRow.trader_id);
      followerRows = fRows || [];
    }
  }
  const followerIds = followerRows.map(r => r.follower_id).sort((a,b)=>a-b);
  const planObj = { signal_id: intent.signal_id, size_value: intent.size_value, followers: followerIds };
  const plan_hash = hashPayload(planObj);
  const { error } = await supabase.from('executed_trades').insert({
    trade_intent_id: intent.id,
    signal_id: intent.signal_id,
    status: 'pending',
    size_value: intent.size_value,
    intent_hash: intent.intent_hash,
    anchor_id: anchor.id,
    payload_hash: anchor.payload_hash,
    plan_hash,
    followers_snapshot: { follower_ids: followerIds }
  });
  if (error) throw error;
  logger.info({ trade_intent_id: intent.id }, 'trade.exec.row.created');
}
