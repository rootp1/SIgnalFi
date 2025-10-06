import { getSupabase } from './supabaseClient';
import { logger } from './logger';
import { getAptosClient } from './aptosClient';

const INTERVAL = Number(process.env.RECON_EXEC_INTERVAL_MS || 30000);
const MODULE_ADDRESS = process.env.MODULE_ADDRESS || process.env.APTOS_MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;

// State (in-memory) for last processed version; persisted in _state table.
let lastVersion: number | null = null;
const STATE_KEY = 'recon_last_version';

export function startExecutionReconciliationWorker() {
  if (!MODULE_ADDRESS) {
    logger.warn('recon.exec.disabled.no_module');
    return;
  }
  setInterval(runCycle, INTERVAL).unref();
  logger.info({ interval: INTERVAL }, 'recon.exec.started');
}

async function runCycle() {
  try {
    const supabase = getSupabase();
    // Load persisted last version if not cached
    if (lastVersion === null) {
      try {
        const { data: st } = await supabase.from('_state').select('value').eq('key', STATE_KEY).maybeSingle();
        if (st?.value) lastVersion = Number(st.value);
      } catch {}
    }
    // Fetch up to N non-verified executed trades as candidates (limit for safety)
    const { data: pending, error } = await supabase
      .from('executed_trades')
      .select('id, intent_hash, follower_count, onchain_verified, plan_hash')
      .is('onchain_verified', null)
      .neq('status', 'failed')
      .limit(100);
    if (error) { logger.error({ err: error }, 'recon.exec.fetch.error'); return; }
    if (!pending || !pending.length) return;
    // For each, attempt to verify via event logs.
    // NOTE: Aptos TS SDK does not expose direct event query by arbitrary handle without address.
    // Simplified approach: fetch recent transactions from account (module address signer)
    // and scan events. (In production, use indexer or event APIs.)
    const { aptos } = await getAptosClient();
  // Fetch recent transactions (limit 100) and filter by version > lastVersion if present.
    const account = MODULE_ADDRESS;
    let txns: any[] = [];
    try {
      // aptos.getAccountTransactions may exist (depending on sdk version). Fallback if not.
      // @ts-ignore
      if (aptos.getAccountTransactions) {
        // @ts-ignore
  txns = await aptos.getAccountTransactions({ accountAddress: account, limit: 100 });
      } else {
        // No direct method; skip reconciliation this cycle.
        logger.warn('recon.exec.no_account_tx_api');
        return;
      }
    } catch (e: any) {
      logger.error({ err: e?.message }, 'recon.exec.tx.fetch.error');
      return;
    }
    const intentMap = new Map(pending.map(p => [normalizeHex(p.intent_hash), p]));
    let updates: { id: number; verified: boolean; version?: number; tx?: string; mismatch?: string }[] = [];
    let maxVersion = lastVersion || 0;
    for (const tx of txns) {
      if (!tx || !Array.isArray(tx.events)) continue;
      const txVersion = Number(tx.version || 0);
      if (lastVersion && txVersion <= lastVersion) continue;
      for (const ev of tx.events) {
        const data = (ev as any).data;
        if (!data) continue;
        // Expect fields intent_hash (vector<u8> hex) OR raw bytes vector representation.
        let ih: string | null = null;
        if (data.intent_hash) {
          ih = String(data.intent_hash).toLowerCase();
          if (!ih.startsWith('0x')) ih = '0x' + ih;
        } else if (data.hash_bytes) { // fallback naming possibility
          try {
            const arr: number[] = data.hash_bytes;
            ih = '0x' + Buffer.from(arr).toString('hex');
          } catch {}
        }
        if (!ih) continue;
        const norm = normalizeHex(ih);
  const pendingRow = intentMap.get(norm);
        if (!pendingRow) continue;
        // follower_count check if present
        let followerCountEvent: number | null = null;
        if (data.follower_count !== undefined) {
          followerCountEvent = Number(data.follower_count);
        }
        // If DB row has follower_count null, update it from snapshot length (lazy fill)
        // We'll fetch snapshot length separately if necessary.
        // For now, treat mismatch as still verifiable (just record ts).
        // For v2 events, compare plan hash if present
        let mismatch: string | undefined;
        if (data.plan_hash && pendingRow.plan_hash) {
          const chainPlan = normalizeHex(String(data.plan_hash));
          const localPlan = normalizeHex(String(pendingRow.plan_hash));
          if (chainPlan !== localPlan) mismatch = 'PLAN_HASH_MISMATCH';
        }
        updates.push({ id: pendingRow.id, verified: !mismatch, version: txVersion, tx: tx.hash, mismatch });
        if (txVersion > maxVersion) maxVersion = txVersion;
      }
    }
    if (!updates.length) return;
    for (const u of updates) {
      const update: any = { onchain_verified: u.verified };
      if (u.version) update.onchain_event_version = u.version;
      if (u.tx) update.onchain_event_tx_hash = u.tx;
      if (u.mismatch) update.error = u.mismatch;
      const { error: upErr } = await supabase.from('executed_trades').update(update).eq('id', u.id);
      if (upErr) logger.warn({ id: u.id, err: upErr }, 'recon.exec.update.warn');
    }
    if (maxVersion && maxVersion !== lastVersion) {
      lastVersion = maxVersion;
      await supabase.from('_state').upsert({ key: STATE_KEY, value: String(maxVersion) }, { onConflict: 'key' });
    }
    logger.info({ verified: updates.filter(u=>u.verified).length, mismatches: updates.filter(u=>u.mismatch).length, lastVersion }, 'recon.exec.cycle.done');
  } catch (e: any) {
    logger.error({ err: e?.message }, 'recon.exec.cycle.error');
  }
}

function normalizeHex(h: string): string {
  const x = h.toLowerCase();
  return x.startsWith('0x') ? x : '0x' + x;
}
