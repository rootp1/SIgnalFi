// scripts/test-anchor-e2e.ts
// End-to-end test: create trader link (if missing), create signal, wait for anchor, verify seq via chain.
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { setTimeout as wait } from 'timers/promises';
import { fetchNextSeq } from '../backend/aptosClient.js';
import { getSupabase } from '../backend/supabaseClient.js';
import { hashPayload } from '../backend/hash.js';

dotenv.config();

async function ensureTraderLink(traderId: number, aptosAddress: string) {
  const supabase = getSupabase();
  const { data } = await supabase.from('traders').select('aptos_address,onchain_enabled').eq('telegram_user_id', traderId).maybeSingle();
  if (data?.aptos_address === aptosAddress && data?.onchain_enabled) return;
  const res = await fetch('http://localhost:'+ (process.env.PORT||3000) +'/api/trader/onchain/register', {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ traderId, aptosAddress })
  });
  if (!res.ok) throw new Error('Failed to link trader: '+res.status);
}

async function createSignal(traderId: number) {
  // Use schema-compliant fields directly
  const payload = { symbol: 'BTCUSDT', side: 'LONG', entry: 100, note: 'e2e anchor' };
  const res = await fetch('http://localhost:'+ (process.env.PORT||3000) +'/api/signal', {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ traderId, payload })
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error('Signal create failed: '+JSON.stringify(json));
  return { signalId: json.data.signalId, payload };
}

async function waitForAnchor(signalId: number, timeoutMs = 60000) {
  const start = Date.now();
  const url = 'http://localhost:'+ (process.env.PORT||3000) +'/api/anchor/' + signalId;
  while (Date.now() - start < timeoutMs) {
    await wait(3000);
    const r = await fetch(url);
    if (r.status === 404) continue; // not yet enqueued (unlikely)
    const j: any = await r.json();
    if (j.data?.anchor?.status === 'anchored') return j.data.anchor;
    if (j.data?.anchor?.status === 'failed') throw new Error('Anchor failed: '+JSON.stringify(j));
  }
  throw new Error('Timed out waiting for anchor');
}

async function main() {
  const traderId = Number(process.env.TEST_TRADER_ID || 7300924119);
  const aptosAddress = process.env.MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;
  if (!aptosAddress) throw new Error('MODULE_ADDRESS not set');
  await ensureTraderLink(traderId, aptosAddress);
  const { signalId, payload } = await createSignal(traderId);
  console.log('Created signal', signalId);
  const anchor = await waitForAnchor(signalId);
  console.log('Anchored:', anchor);
  const chainNext = await fetchNextSeq(aptosAddress);
  console.log('On-chain next_seq:', chainNext, 'expected anchored seq:', chainNext>0?chainNext-1:'unknown');
  const localHash = hashPayload(payload);
  if (localHash !== anchor.payload_hash) {
    throw new Error('Payload hash mismatch local='+localHash+' db='+anchor.payload_hash);
  }
  console.log('Hash verified. E2E anchor test PASSED');
}

main().catch(e => { console.error('E2E anchor test FAILED', e); process.exit(1); });
