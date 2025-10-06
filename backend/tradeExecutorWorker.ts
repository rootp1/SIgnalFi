import { getSupabase } from './supabaseClient';
import { logger } from './logger';
import { hashPayload } from './hash';
import { getAptosClient } from './aptosClient';

const INTERVAL = Number(process.env.TRADE_EXECUTOR_INTERVAL_MS || 15000);
const ONCHAIN_ENABLED = process.env.EXECUTION_MODE === 'onchain';
const MODULE_ADDRESS = process.env.MODULE_ADDRESS || process.env.APTOS_MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;
const USE_V2 = process.env.VAULT_EVENT_V2 === '1';
const SCHEMA_VERSION = 1;
const MOCK_SLIPPAGE = process.env.MOCK_SLIPPAGE === '1';
const FIXED_SLIPPAGE_BPS = process.env.MOCK_SLIPPAGE_BPS ? Number(process.env.MOCK_SLIPPAGE_BPS) : undefined;

function computeMockSlippage(): number | null {
  if (!MOCK_SLIPPAGE) return null;
  if (typeof FIXED_SLIPPAGE_BPS === 'number' && !Number.isNaN(FIXED_SLIPPAGE_BPS)) return FIXED_SLIPPAGE_BPS;
  // Random 0-50 bps for demo
  return Math.floor(Math.random() * 51);
}

export function startTradeExecutorWorker() {
  setInterval(processTradeIntents, INTERVAL).unref();
  logger.info({ interval: INTERVAL, onchain: ONCHAIN_ENABLED }, 'trade.executor.started');
}

async function processTradeIntents() {
  const supabase = getSupabase();
  // Fetch intents + anchor verification status
  const { data, error } = await supabase
    .from('trade_intents')
    .select('id, signal_id, action, market, size_mode, size_value, max_slippage_bps, deadline_ts, intent_hash, executed:executed_trades(id)')
    .limit(50);
  if (error) { logger.error({ err: error }, 'trade.intent.fetch.error'); return; }
  if (!data || !data.length) return;
  for (const intent of data as any[]) {
    if (intent.executed && intent.executed.length) continue; // already has an execution row
    // Fetch verified anchor row for this signal_id
    if (!intent.signal_id) continue;
    const { data: anchorRow, error: aErr } = await supabase
      .from('anchored_signals')
      .select('id, signal_id, verification_status, payload_hash')
      .eq('signal_id', intent.signal_id)
      .maybeSingle();
    if (aErr) { logger.warn({ intent: intent.id, err: aErr }, 'trade.exec.anchor.lookup.warn'); continue; }
    if (!anchorRow) { logger.debug({ intent: intent.id }, 'trade.exec.anchor.missing'); continue; }
    if (anchorRow.verification_status !== 'verified') { logger.debug({ intent: intent.id, status: anchorRow.verification_status }, 'trade.exec.anchor.not_verified'); continue; }
    logger.info({ intent: intent.id, signal: intent.signal_id }, 'trade.exec.anchor.verified');
    await createExecutionRow(intent, anchorRow).catch((e: any) => logger.error({ id: intent.id, err: e }, 'trade.exec.row.create.error'));
  }
  // Now process newly created pending rows
  const { data: execRows, error: execErr } = await supabase
    .from('executed_trades')
    .select('id, trade_intent_id, signal_id, status, attempts, next_attempt_at, error')
    .eq('status', 'pending')
    .limit(25);
  if (execErr) { logger.error({ err: execErr }, 'trade.exec.fetch.error'); return; }
  for (const row of execRows || []) {
    // Respect backoff schedule
    if (row.next_attempt_at && Date.now() < new Date(row.next_attempt_at).getTime()) continue;
    if (ONCHAIN_ENABLED) {
      await executeOnChain(row).catch(e => logger.error({ id: row.id, err: e }, 'trade.exec.onchain.error'));
    } else {
      await simulateExecution(row).catch(e => logger.error({ id: row.id, err: e }, 'trade.exec.simulate.error'));
    }
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
  const slippage_bps = computeMockSlippage();
  const update: any = { status: 'simulated', tx_hash: pseudoTx, executed_at: new Date().toISOString() };
  if (slippage_bps != null) update.slippage_bps = slippage_bps;
  const { error: upErr } = await supabase
    .from('executed_trades')
    .update(update)
    .eq('id', row.id);
  if (upErr) throw upErr;
  logger.info({ id: row.id, pseudoTx }, 'trade.exec.simulated');
}

async function executeOnChain(row: any) {
  if (!MODULE_ADDRESS) {
    logger.warn('No MODULE_ADDRESS set; falling back to simulation');
    return simulateExecution(row);
  }
  const supabase = getSupabase();
  // Lookup intent for constraints
  const { data: intentMeta } = await supabase.from('trade_intents').select('deadline_ts, max_slippage_bps, intent_hash').eq('id', row.trade_intent_id).maybeSingle();
  if (intentMeta?.deadline_ts && Date.now() > new Date(intentMeta.deadline_ts).getTime()) {
    await supabase.from('executed_trades').update({ status: 'failed', error: 'DEADLINE_EXPIRED' }).eq('id', row.id);
    return;
  }
  // Mark as submitting to avoid duplicate attempts in overlapping intervals
  const { error: markErr } = await supabase.from('executed_trades').update({ status: 'submitting' }).eq('id', row.id).eq('status', 'pending');
  if (markErr) { logger.warn({ id: row.id, err: markErr }, 'trade.exec.submit.mark.warn'); return; }
  // Re-fetch to ensure still submitting
  const { data: current, error: curErr } = await supabase.from('executed_trades').select('id, trade_intent_id, status, payload_hash, plan_hash').eq('id', row.id).maybeSingle();
  if (curErr || !current || current.status !== 'submitting') return;
  const { data: intentRow, error: intentErr } = await supabase.from('trade_intents').select('intent_hash').eq('id', row.trade_intent_id).maybeSingle();
  if (intentErr || !intentRow) {
    await supabase.from('executed_trades').update({ status: 'failed', error: 'INTENT_NOT_FOUND' }).eq('id', row.id); return;
  }
  // Count followers from snapshot (safer than re-querying live)
  const { data: execSnap, error: snapErr } = await supabase.from('executed_trades').select('followers_snapshot, follower_count').eq('id', row.id).maybeSingle();
  let followerCount = (!snapErr && execSnap && execSnap.followers_snapshot && Array.isArray(execSnap.followers_snapshot.follower_ids)) ? execSnap.followers_snapshot.follower_ids.length : 0;
  if (execSnap && execSnap.follower_count != null) followerCount = execSnap.follower_count;
  if (execSnap && execSnap.follower_count == null) {
    await supabase.from('executed_trades').update({ follower_count: followerCount }).eq('id', row.id);
  }
  try {
    const { aptos, sdk } = await getAptosClient();
    const { Ed25519PrivateKey } = sdk;
    const pkHex = process.env.APTOS_PRIVATE_KEY;
    if (!pkHex) throw new Error('MISSING_PRIVATE_KEY');
    const cleanKey = pkHex.replace(/^0x/, '');
    const pk = new Ed25519PrivateKey('0x' + cleanKey);
    const signer = await sdk.Account.fromPrivateKey({ privateKey: pk });
    const intentBytes = Uint8Array.from(Buffer.from(intentRow.intent_hash.replace(/^0x/, ''), 'hex'));
  const planSource = (current as any).plan_hash || (current as any).payload_hash || intentRow.intent_hash;
  const planBytes = Uint8Array.from(Buffer.from(planSource.replace(/^0x/, ''), 'hex'));
    const func = USE_V2 ? `${MODULE_ADDRESS}::vault_v2::execute_trade_v2` : `${MODULE_ADDRESS}::vault::execute_trade`;
    const args = USE_V2 ? [intentBytes, planBytes, followerCount, SCHEMA_VERSION] : [intentBytes, followerCount];
    const txn = await aptos.transaction.build.simple({
      sender: signer.accountAddress,
      data: { function: func, functionArguments: args }
    });
    const pending = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
    logger.info({ id: row.id, tx: pending.hash }, 'trade.exec.submitted');
    await aptos.waitForTransaction({ transactionHash: pending.hash });
  const slippage_bps = computeMockSlippage();
  const execUpdate: any = { status: 'executed', tx_hash: pending.hash, executed_at: new Date().toISOString(), attempts: (row.attempts||0)+1, next_attempt_at: null };
  if (slippage_bps != null) execUpdate.slippage_bps = slippage_bps;
  const { error: upErr } = await supabase.from('executed_trades').update(execUpdate).eq('id', row.id);
    if (upErr) throw upErr;
  } catch (e: any) {
    logger.error({ id: row.id, err: e?.message }, 'trade.exec.onchain.fail');
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= 5) {
      await supabase.from('executed_trades').update({ status: 'failed', error: e?.message || 'ONCHAIN_FAIL', attempts }).eq('id', row.id);
    } else {
      const delayMs = Math.min(60000, 2000 * Math.pow(2, attempts - 1));
      const next = new Date(Date.now() + delayMs).toISOString();
      await supabase.from('executed_trades').update({ status: 'pending', error: e?.message || 'ONCHAIN_FAIL', attempts, next_attempt_at: next }).eq('id', row.id);
    }
  }
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
    followers_snapshot: { follower_ids: followerIds },
    follower_count: followerIds.length,
    attempts: 0,
    next_attempt_at: new Date().toISOString()
  });
  if (error) throw error;
  logger.info({ trade_intent_id: intent.id }, 'trade.exec.row.created');
}
