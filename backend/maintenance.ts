import { getSupabase } from './supabaseClient';
import { logger } from './logger';

export async function cleanupExpiredNonces(): Promise<{ deleted: number }> {
  const supabase = getSupabase();
  // Delete rows where nonce expired; return deleted rows for count
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_wallets')
    .delete()
    .lt('nonce_expires_at', nowIso)
    .not('nonce', 'is', null)
    .select('telegram_user_id');
  if (error) {
    logger.error({ err: error }, 'nonce.cleanup.error');
    throw error;
  }
  const deleted = data?.length || 0;
  if (deleted > 0) logger.info({ deleted }, 'nonce.cleanup.success');
  return { deleted };
}

export function scheduleNonceCleanup() {
  const interval = Number(process.env.NONCE_CLEAN_INTERVAL_MS || 10 * 60 * 1000);
  setInterval(() => {
    cleanupExpiredNonces().catch(err => logger.warn({ err }, 'nonce.cleanup.scheduled_failed'));
  }, interval).unref();
}