// scripts/test-wallet.ts
// Simple wallet flow test: challenge -> verify (with fake signature expected to fail) -> expect error.
// Real signature test would require a private key; we keep this as a negative test placeholder.
import fetch from 'node-fetch';

const API = `http://localhost:${process.env.PORT || 3000}/api`;

async function j(path: string, opts: any = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }});
  let body: any = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

async function main() {
  const user = 999001;
  console.log('Request challenge');
  let resp = await j('/wallet/challenge', { method: 'POST', body: JSON.stringify({ telegramUserId: user }) });
  if (resp.status !== 200) throw new Error('challenge failed');
  const nonce = resp.body.nonce;
  console.log('Nonce:', nonce, 'ExpiresAt:', resp.body.expiresAt);

  console.log('Attempt invalid verify');
  resp = await j('/wallet/verify', { method: 'POST', body: JSON.stringify({ telegramUserId: user, address: '0x0000000000000000000000000000000000000000', signature: '0xdeadbeef' }) });
  if (resp.status === 200) throw new Error('verify should not succeed with invalid signature');
  if (!resp.body?.error) throw new Error('expected error shape');
  console.log('Received expected error code:', resp.body.error.code);

  console.log('Wallet negative flow test completed.');
}

main().catch(e => { console.error('wallet test failed', e); process.exit(1); });
