// scripts/test-e2e.ts
// Simple sequential E2E smoke test for follow + settings endpoints.
// Assumes backend already running on PORT (default 3000).

import assert from 'assert';
import fetch from 'node-fetch';

const API = `http://localhost:${process.env.PORT || 3000}/api`;

async function j(path: string, opts: any = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body: any = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

async function main() {
  const follower = 1111;
  const trader = 2222;

  console.log('1) Follow trader');
  let resp = await j('/follow', { method: 'POST', body: JSON.stringify({ userId: follower, traderToFollow: trader }) });
  assert([200,201].includes(resp.status), 'follow status unexpected');

  console.log('2) List follows');
  resp = await j(`/follows/${follower}`);
  assert(resp.status === 200, 'follows list failed');
  assert(Array.isArray(resp.body.follows), 'follows not array');
  assert(resp.body.follows.some((f: any) => f.trader_id === trader), 'trader not in follows');

  console.log('3) Update settings');
  resp = await j('/settings', { method: 'POST', body: JSON.stringify({ userId: follower, tradeAmount: '100', riskMultiplier: '1.1', notifySignals: true }) });
  assert(resp.status === 200, 'settings update failed');

  console.log('4) Get settings');
  resp = await j(`/settings/${follower}`);
  assert(resp.status === 200, 'settings get failed');
  const amt = resp.body.settings.trade_amount_numeric;
  assert(amt == '100', 'trade amount mismatch');
  assert(resp.body.settings.risk_multiplier == '1.1', 'risk multiplier mismatch');

  console.log('5) Unfollow');
  resp = await j('/unfollow', { method: 'POST', body: JSON.stringify({ userId: follower, traderId: trader }) });
  assert(resp.status === 200, 'unfollow failed');

  console.log('6) Confirm unfollow');
  resp = await j(`/follows/${follower}`);
  assert(resp.status === 200, 'confirm follows list failed');
  assert(!resp.body.follows.some((f: any) => f.trader_id === trader), 'trader still followed');

  console.log('7) Create signal (no followers now)');
  resp = await j('/signal', { method: 'POST', body: JSON.stringify({ traderId: trader, payload: { symbol: 'BTCUSDT', side: 'BUY', note: 'test-broadcast' } }) });
  assert(resp.status === 201, 'signal create failed');
  assert(resp.body.followerCount === 0, 'unexpected follower count');
  assert(resp.body.delivered === 0 && resp.body.failed === 0, 'delivery counts mismatch');

  console.log('8) List signals');
  resp = await j('/signals?limit=5');
  assert(resp.status === 200, 'signals list failed');
  assert(Array.isArray(resp.body.signals), 'signals not array');
  assert(resp.body.signals.some((s: any) => s.payload.symbol === 'BTCUSDT'), 'signal not found in list');

  console.log('\nAll E2E checks passed.');
}

main().catch(e => { console.error('E2E test failed:', e); process.exit(1); });
