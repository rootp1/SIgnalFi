import { logger } from './logger';

// Dynamic import of Aptos TS SDK (we use @aptos-labs/ts-sdk which is already in package.json)
let sdk: any;

// Returns { aptos, sdk } where aptos is an Aptos client instance and sdk exposes constructors.
export async function getAptosClient() {
  if (!sdk) {
    try {
      sdk = await import('@aptos-labs/ts-sdk');
    } catch (e) {
      logger.error('Aptos TS SDK not installed. Install with: npm install @aptos-labs/ts-sdk');
      throw e;
    }
  }
  const { Aptos, AptosConfig, Network } = sdk;
  const nodeUrl = process.env.APTOS_NODE_URL;
  const config = new AptosConfig({ network: nodeUrl ? undefined : Network.TESTNET, fullnodeUrl: nodeUrl });
  return { aptos: new Aptos(config), sdk };
}

/**
 * Reads the Trader resource directly to obtain next_signal_seq.
 * Returns next_signal_seq or 0 if resource not present.
 */
export async function fetchNextSeq(traderAddress: string): Promise<number> {
  try {
    const moduleAddress = process.env.MODULE_ADDRESS || process.env.APTOS_MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;
    if (!moduleAddress) return 0;
    const { aptos } = await getAptosClient();
    const resourceType = `${moduleAddress}::registry::Trader`;
    const res: any = await aptos.getAccountResource({ accountAddress: traderAddress, resourceType });
    const n = Number(res?.data?.next_signal_seq ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch (e: any) {
    if (e?.status === 404) return 0; // resource not created yet
    logger.error({ traderAddress, err: e?.message }, 'aptos.fetchNextSeq.error');
    return 0;
  }
}

/** Fetch last anchor metadata (if LastAnchor resource exists). */
export async function fetchLastAnchor(traderAddress: string): Promise<{ exists: boolean; last_seq: number; last_hash: string; last_ts: number }> {
  try {
    const moduleAddress = process.env.MODULE_ADDRESS || process.env.APTOS_MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;
    if (!moduleAddress) return { exists: false, last_seq: 0, last_hash: '0x', last_ts: 0 };
    const { aptos } = await getAptosClient();
    const resourceType = `${moduleAddress}::registry::LastAnchor`;
    const res: any = await aptos.getAccountResource({ accountAddress: traderAddress, resourceType });
    if (!res?.data) return { exists: false, last_seq: 0, last_hash: '0x', last_ts: 0 };
    const hashVec: number[] = res.data.last_hash || [];
    const hex = '0x' + Buffer.from(hashVec).toString('hex');
    return { exists: true, last_seq: Number(res.data.last_seq || 0), last_hash: hex, last_ts: Number(res.data.last_ts || 0) };
  } catch (e: any) {
    if (e?.status === 404) return { exists: false, last_seq: 0, last_hash: '0x', last_ts: 0 };
    logger.error({ traderAddress, err: e?.message }, 'aptos.fetchLastAnchor.error');
    return { exists: false, last_seq: 0, last_hash: '0x', last_ts: 0 };
  }
}

/** Fetch a full transaction by hash (returns undefined if not found or error). */
export async function fetchTransaction(txHash: string): Promise<any | undefined> {
  try {
    const { aptos } = await getAptosClient();
    const tx = await aptos.getTransactionByHash({ transactionHash: txHash });
    return tx;
  } catch (e: any) {
    if (e?.status === 404) return undefined;
    logger.error({ txHash, err: e?.message }, 'aptos.fetchTransaction.error');
    return undefined;
  }
}

/**
 * Attempts to submit an anchor_signal_relay transaction.
 * Falls back to throwing if required env vars are missing.
 * Env:
 *  - APTOS_PRIVATE_KEY : hex (with or without 0x) Ed25519 private key (32 bytes)
 *  - MODULE_ADDRESS    : address where registry module is published (e.g. 0x9df7...5306b)
 *  - OPTIONAL APTOS_NODE_URL : custom fullnode
 */
export async function submitRelayAnchor(traderAddress: string, payloadHashHex: string): Promise<{ txHash: string }> {
  const privateKeyHexRaw = process.env.APTOS_PRIVATE_KEY;
  const moduleAddress = process.env.MODULE_ADDRESS || process.env.APTOS_MODULE_ADDRESS || process.env.APTOS_ACCOUNT_ADDRESS;
  if (!privateKeyHexRaw || !moduleAddress) {
    throw new Error('MISSING_ENV: APTOS_PRIVATE_KEY and MODULE_ADDRESS required for on-chain anchoring');
  }
  const cleanKey = privateKeyHexRaw.replace(/^0x/, '');
  if (cleanKey.length !== 64) { // 32 bytes
    throw new Error('INVALID_PRIVATE_KEY_LENGTH');
  }
  const hashNoPrefix = payloadHashHex.replace(/^0x/, '');
  const hashBytes = Uint8Array.from(Buffer.from(hashNoPrefix, 'hex'));

  try {
    const { aptos, sdk } = await getAptosClient();
    const { Ed25519PrivateKey, AccountAddress } = sdk;
    // Construct signer from raw private key
    const pk = new Ed25519PrivateKey(`0x${cleanKey}`);
    // fromPrivateKey (ts-sdk v5) -> account
    const signer = await sdk.Account.fromPrivateKey({ privateKey: pk });
    const func = `${moduleAddress}::registry::anchor_signal_relay`;
    const txn = await aptos.transaction.build.simple({
      sender: signer.accountAddress,
      data: {
        function: func,
        functionArguments: [traderAddress, hashBytes],
      },
    });
    const committed = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
    await aptos.waitForTransaction({ transactionHash: committed.hash });
    return { txHash: committed.hash };
  } catch (e: any) {
    logger.error({ err: e }, 'aptos.anchor.submit.error');
    throw e;
  }
}