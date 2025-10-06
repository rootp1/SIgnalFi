import { getSupabase } from './supabaseClient';
import { logger } from './logger';
import { hashPayload } from './hash';
import { submitRelayAnchor, fetchNextSeq } from './aptosClient';

const INTERVAL = Number(process.env.ANCHOR_POLL_INTERVAL_MS || 8000);

export function startAnchorWorker() {
  setInterval(processAnchors, INTERVAL).unref();
  logger.info({ interval: INTERVAL }, 'anchor.worker.started');
}

async function processAnchors() {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('anchored_signals')
    .select('id, signal_id, status, attempts, next_attempt_at, signals:signals!inner(trader_id, payload), traders:signals!inner(trader_id)')
    .in('status', ['pending','retry'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order('id', { ascending: true })
    .limit(25);
  if (error) {
    logger.error({ err: error }, 'anchor.fetch.error');
    return;
  }
  if (!data || !data.length) return;
  for (const row of data as any[]) {
    await handleAnchor(row).catch(err => logger.error({ id: row.id, err }, 'anchor.process.error'));
  }
}

async function handleAnchor(row: any) {
  const supabase = getSupabase();
  const traderId = row.signals.trader_id;
  // Fetch trader aptos address & last seq
  const { data: traderRow, error: tErr } = await supabase.from('traders').select('aptos_address, last_onchain_seq').eq('telegram_user_id', traderId).maybeSingle();
  if (tErr || !traderRow?.aptos_address) {
    await supabase.from('anchored_signals').update({ status: 'failed' }).eq('id', row.id);
    return;
  }
  const payloadHash = hashPayload(row.signals.payload);
  const payloadHashHex = payloadHash.startsWith('0x') ? payloadHash : '0x' + payloadHash;
  const haveEnv = !!process.env.APTOS_PRIVATE_KEY && !!(process.env.MODULE_ADDRESS || process.env.APTOS_MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS);
  let txHash: string;
  let seq: number;
  try {
    if (haveEnv) {
      const result = await submitRelayAnchor(traderRow.aptos_address, payloadHashHex);
      txHash = result.txHash;
      // Fetch chain state to get authoritative next_signal_seq then derive anchored seq
      const nextSeq = await fetchNextSeq(traderRow.aptos_address);
      seq = nextSeq > 0 ? nextSeq - 1 : (traderRow.last_onchain_seq || 0) + 1;
    } else {
      // Simulation fallback
      txHash = '0xSIMULATED_' + Date.now();
      seq = (traderRow.last_onchain_seq || 0) + 1;
    }
  const { error: upErr } = await supabase.from('anchored_signals').update({ status: 'anchored', seq, tx_hash: txHash, payload_hash: payloadHash, attempts: (row.attempts||0), verification_status: 'verified', verified_at: new Date().toISOString() }).eq('id', row.id);
    if (upErr) logger.error({ id: row.id, err: upErr }, 'anchor.update.error');
    const { error: seqErr } = await supabase.from('traders').update({ last_onchain_seq: seq }).eq('telegram_user_id', traderId);
    if (seqErr) logger.error({ traderId, err: seqErr }, 'anchor.seq.update.error');
  } catch (e: any) {
    logger.error({ id: row.id, err: e }, 'anchor.tx.submit.error');
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= Number(process.env.ANCHOR_MAX_ATTEMPTS || 3)) {
      const { error: failErr } = await supabase.from('anchored_signals').update({ status: 'failed', attempts, last_error: String(e?.message||e) }).eq('id', row.id);
      if (failErr) logger.error({ id: row.id, err: failErr }, 'anchor.fail.update.error');
    } else {
      // exponential backoff base 5s
      const delayMs = 5000 * Math.pow(2, attempts - 1);
      const nextAttempt = new Date(Date.now() + delayMs).toISOString();
      const { error: retryErr } = await supabase.from('anchored_signals').update({ status: 'retry', attempts, last_error: String(e?.message||e), next_attempt_at: nextAttempt }).eq('id', row.id);
      if (retryErr) logger.error({ id: row.id, err: retryErr }, 'anchor.retry.update.error');
    }
  }
}