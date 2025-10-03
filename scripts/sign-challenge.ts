// Helper script to locally sign a wallet challenge message
// Usage: npm run sign:challenge -- <PRIVATE_KEY> "SignalFi Wallet Verification: <nonce>"
// Prints address + signature

import { Wallet } from 'ethers';

async function main() {
  const [, , pk, ...rest] = process.argv;
  if (!pk || rest.length === 0) {
    console.error('Usage: npm run sign:challenge -- <PRIVATE_KEY> "SignalFi Wallet Verification: <nonce>"');
    process.exit(1);
  }
  const message = rest.join(' ');
  if (!message.startsWith('SignalFi Wallet Verification: ')) {
    console.warn('Warning: message does not start with expected prefix.');
  }
  const wallet = new Wallet(pk);
  const sig = await wallet.signMessage(message);
  console.log(JSON.stringify({ address: wallet.address, signature: sig, message }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
