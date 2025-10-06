// scripts/test-signal-auth.ts
// Verifies that /api/signal rejects unverified trader and succeeds after verification.
import assert from 'assert';
import fetch from 'node-fetch';
import { ethers } from 'ethers';

const API = `http://localhost:${process.env.PORT || 3000}/api`;

async function j(path: string, opts: any = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }});
  let body: any = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

async function ensureChallenge(userId: number) {
  const challenge = await j('/wallet/challenge', { method: 'POST', body: JSON.stringify({ telegramUserId: userId }) });
  assert.equal(challenge.status, 200, 'challenge failed');
  return challenge.body;
}

async function verify(userId: number, privKey: string) {
  const { nonce, messageToSign } = await ensureChallenge(userId);
  const wallet = new ethers.Wallet(privKey);
  const signature = await wallet.signMessage(messageToSign);
  const verifyResp = await j('/wallet/verify', { method: 'POST', body: JSON.stringify({ telegramUserId: userId, address: wallet.address, signature }) });
  assert.equal(verifyResp.status, 200, 'verify failed');
}

async function main() {
  const trader = 777001; // arbitrary test trader id

  console.log('1) Attempt signal broadcast with unverified trader');
  let resp = await j('/signal', { method: 'POST', body: JSON.stringify({ traderId: trader, payload: { symbol: 'ETHUSDT', side: 'SELL', note: 'pre-verify' } }) });
  assert.equal(resp.status, 403, 'Expected 403 for unverified trader');
  assert(resp.body?.error?.code === 'TRADER_UNVERIFIED', 'Expected TRADER_UNVERIFIED error code');

  console.log('2) Verify trader wallet');
  const testPriv = ethers.Wallet.createRandom().privateKey;
  await verify(trader, testPriv);

  console.log('3) Broadcast signal after verification');
  resp = await j('/signal', { method: 'POST', body: JSON.stringify({ traderId: trader, payload: { symbol: 'ETHUSDT', side: 'SELL', note: 'post-verify' } }) });
  assert.equal(resp.status, 201, 'signal should succeed post verification');
  assert(resp.body.signalId, 'missing signalId');

  console.log('4) Fetch signals for trader and confirm latest');
  const list = await j(`/signals?traderId=${trader}&limit=3`);
  assert.equal(list.status, 200, 'signals list failed');
  assert(list.body.signals.some((s: any) => s.payload.note === 'post-verify'), 'verified signal not found');

  console.log('\nSignal auth test passed.');
}

main().catch(e => { console.error('signal auth test failed', e); process.exit(1); });
