// scripts/test-anchor.ts
// Quick E2E-ish test for anchoring pipeline (DB -> anchored_signals -> worker updates)
// Usage: tsx scripts/test-anchor.ts
// Pre-req: SUPABASE_URL + anon/service key envs set so supabaseClient works OR rely on direct PG via SUPABASE_DB_URL? (We use supabase-js path for consistency)
import { getSupabase } from '../backend/supabaseClient.js';
import { hashPayload } from '../backend/hash.js';

async function main() {
  const supabase = getSupabase();
  // 1. Ensure a trader row exists
  const telegramUserId = 'anchor_test_user';
  const aptosAddress = process.env.TEST_APTOS_TRADER || '0x1';
  let { data: trader, error: tErr } = await supabase
    .from('traders')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!trader) {
    const { error: insErr } = await supabase.from('traders').insert({ telegram_user_id: telegramUserId, aptos_address: aptosAddress, onchain_enabled: true });
    if (insErr) throw insErr;
    console.log('Inserted trader');
  }
  // 2. Insert a signal
  const payload = { pair: 'BTC/USDT', side: 'long', ts: Date.now() };
  const { data: sigRows, error: sigErr } = await supabase
    .from('signals')
    .insert({ trader_id: telegramUserId, payload })
    .select('id')
    .limit(1);
  if (sigErr) throw sigErr;
  const signalId = sigRows![0].id;
  console.log('Inserted signal', signalId);
  // 3. Enqueue anchored_signals row (simulate what /api/signal does)
  const payloadHash = hashPayload(payload);
  const { error: ancErr } = await supabase
    .from('anchored_signals')
    .insert({ signal_id: signalId, status: 'pending', payload_hash: payloadHash });
  if (ancErr) throw ancErr;
  console.log('Enqueued anchor');
  // 4. Poll for worker outcome
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { data: row, error: rErr } = await supabase
      .from('anchored_signals')
      .select('status, tx_hash, seq, payload_hash')
      .eq('signal_id', signalId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (row && row.status !== 'pending') {
      console.log('Anchor result:', row);
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.error('Timed out waiting for anchor worker. Is startAnchorWorker running?');
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
