// scripts/test-full-e2e.ts
// Comprehensive end-to-end test:
// 1. Ensure trader on-chain enabled
// 2. Create followers + settings
// 3. Broadcast signal with embedded intent
// 4. Wait for anchor verification
// 5. Wait for execution row (simulation or on-chain) and reconciliation (if on-chain)
// 6. Fetch unified full signal view & metrics sanity checks
// Requires workers + backend running. For on-chain path set EXECUTION_MODE=onchain and provide keys.

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import assert from 'assert';
import { setTimeout as wait } from 'timers/promises';
import { getSupabase } from '../backend/supabaseClient.js';
import { hashPayload } from '../backend/hash.js';

dotenv.config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const API = BASE + '/api';

async function j(path: string, opts: any = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) } });
  let body: any = null; try { body = await r.json(); } catch {}
  console.log('HTTP', opts.method||'GET', path, '->', r.status);
  if (r.status >= 400) console.log('Body (error):', JSON.stringify(body));
  return { status: r.status, body };
}

async function ensureOnchainTrader(traderId: number, addr: string) {
  const supabase = getSupabase();
  const { data } = await supabase.from('traders').select('aptos_address,onchain_enabled').eq('telegram_user_id', traderId).maybeSingle();
  if (data?.aptos_address === addr && data?.onchain_enabled) return;
  const res = await j('/trader/onchain/register', { method: 'POST', body: JSON.stringify({ traderId, aptosAddress: addr }) });
  assert(res.status === 200, 'onchain register failed');
}

async function waitForAnchor(signalId: number, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await wait(3000);
    const r = await j(`/anchor/${signalId}`);
    if (r.status === 404) continue;
    if (r.body.anchor?.status === 'anchored') return r.body.anchor;
    if (r.body.anchor?.status === 'failed') throw new Error('anchor failed');
    console.log('Anchor pending status:', r.body.anchor?.status);
  }
  throw new Error('anchor timeout');
}

async function waitForExecution(signalId: number, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await wait(4000);
    const r = await j(`/signal/${signalId}/full`);
    if (r.status !== 200) continue;
    const exec = r.body.execution;
    if (exec && (exec.status === 'executed' || exec.status === 'simulated')) return exec;
    if (exec) console.log('Execution present but not finished:', exec.status);
    else console.log('Execution not yet created');
  }
  throw new Error('execution timeout');
}

async function waitForOnchainVerification(executionId: number, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await wait(5000);
    const r = await j(`/executed-trade/${executionId}`);
    if (r.status === 200 && r.body.executed?.onchain_verified) return true;
  }
  return false; // not fatal in simulation
}

async function main() {
  const traderId = Number(process.env.TEST_TRADER_ID || 810000001);
  const followerA = traderId + 1;
  const followerB = traderId + 2;
  const onchainAddr = process.env.MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;
  const onchain = process.env.EXECUTION_MODE === 'onchain';

  if (onchain && !onchainAddr) throw new Error('MODULE_ADDRESS required for on-chain test');
  if (onchain) await ensureOnchainTrader(traderId, onchainAddr!);

  // Followers follow trader
  for (const fid of [followerA, followerB]) {
    await j('/follow', { method: 'POST', body: JSON.stringify({ userId: fid, traderToFollow: traderId }) });
  }

  // Broadcast signal with embedded intent
  const payload = {
    symbol: 'ETHUSDT', side: 'LONG', entry: 1234.56,
    intent: { action: 'BUY', market: 'ETHUSDT', sizeMode: 'NOTIONAL', sizeValue: 50, maxSlippageBps: 25 }
  };
  const sigResp = await j('/signal', { method: 'POST', body: JSON.stringify({ traderId, payload }) });
  assert(sigResp.status === 201, 'signal create failed');
  console.log('Signal response body:', JSON.stringify(sigResp.body));
  const signalId = sigResp.body.signalId;
  console.log('Signal created id=', signalId);
  const expectHash = hashPayload(payload);

  // Wait for anchor
  const anchor = await waitForAnchor(signalId);
  console.log('Anchor status anchored seq=', anchor.seq);
  assert(anchor.payload_hash === expectHash, 'anchor hash mismatch');

  // Wait for execution
  const exec = await waitForExecution(signalId);
  console.log('Execution status', exec.status, 'id=', exec.id, 'tx=', exec.tx_hash);

  if (onchain) {
    const verified = await waitForOnchainVerification(exec.id);
    console.log('On-chain verification:', verified);
  }

  // Full view
  const full = await j(`/signal/${signalId}/full`);
  assert(full.status === 200, 'full view failed');
  assert(full.body.intent?.intent_hash, 'intent missing');
  assert(full.body.execution?.plan_hash, 'plan hash missing');

  // Metrics sanity
  const metrics = await j('/metrics');
  assert(metrics.status === 200, 'metrics failed');
  const et = metrics.body.executedTrades;
  assert(typeof et.total === 'number', 'metrics shape invalid');

  console.log('Full E2E test PASSED');
}

main().catch(e => { console.error('Full E2E FAILED', e); process.exit(1); });
