import { getSupabase } from './supabaseClient';
import { formatSignalMessage, sendTelegramMessage } from './telegram';
import { logger } from './logger';

interface PendingRow {
  id: number;
  signal_id: number;
  follower_id: number;
  attempts: number;
  last_error: string | null;
  payload: any;
  trader_id: number;
}

const MAX_ATTEMPTS = Number(process.env.DELIVERY_MAX_ATTEMPTS || 5);
const BATCH_SIZE = Number(process.env.DELIVERY_BATCH_SIZE || 25);
const INTERVAL_MS = Number(process.env.DELIVERY_POLL_INTERVAL_MS || 5000);

export function startDeliveryWorker() {
  setInterval(processQueue, INTERVAL_MS).unref();
  logger.info({ interval: INTERVAL_MS }, 'delivery.worker.started');
}

async function processQueue() {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  // Fetch queued or retryable deliveries
  const { data, error } = await supabase
    .from('signal_deliveries')
    .select('id, signal_id, follower_id, attempts, last_error, signal:signals!inner(trader_id, payload)')
    .eq('status', 'queued')
    .lte('next_attempt_at', nowIso)
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) {
    logger.error({ err: error }, 'delivery.fetch.error');
    return;
  }
  if (!data || !data.length) return; // idle

  for (const row of data as any as PendingRow[]) {
    await handleRow(row).catch(err => logger.error({ id: row.id, err }, 'delivery.process.error'));
  }
}

async function handleRow(row: PendingRow) {
  const supabase = getSupabase();
  const text = formatSignalMessage(row.trader_id, row.payload);
  const ok = await sendTelegramMessage(row.follower_id, text);
  if (ok) {
    const { error } = await supabase
      .from('signal_deliveries')
      .update({ status: 'delivered', last_error: null, attempts: row.attempts + 1 })
      .eq('id', row.id);
    if (error) logger.error({ id: row.id, err: error }, 'delivery.update.error');
    return;
  }
  // failure path
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const { error } = await supabase
      .from('signal_deliveries')
      .update({ status: 'failed', attempts, last_error: 'max_attempts' })
      .eq('id', row.id);
    if (error) logger.error({ id: row.id, err: error }, 'delivery.fail_update.error');
    return;
  }
  // exponential backoff: base 5s * 2^(attempts-1)
  const delay = 5000 * Math.pow(2, attempts - 1);
  const nextAttempt = new Date(Date.now() + delay).toISOString();
  const { error } = await supabase
    .from('signal_deliveries')
    .update({ attempts, last_error: 'send_failed', next_attempt_at: nextAttempt })
    .eq('id', row.id);
  if (error) logger.error({ id: row.id, err: error }, 'delivery.retry_update.error');
}