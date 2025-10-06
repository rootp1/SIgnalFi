// backend/server.ts
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { getSupabase } from './supabaseClient';
import { followRequestSchema, settingsUpdateSchema, unfollowSchema, parse, signalRequestSchema } from './validation';
import { sendTelegramMessage, formatSignalMessage } from './telegram';
import { globalLimiter, followLimiter, signalLimiter, walletLimiter } from './rateLimit';
import { respondSuccess, respondError, errorMiddleware, requestIdMiddleware } from './response';
import { logger, childLogger } from './logger';
import { scheduleNonceCleanup, cleanupExpiredNonces } from './maintenance';
import { startDeliveryWorker } from './deliveryWorker';
import { startAnchorWorker } from './anchorWorker';
import { hashPayload } from './hash';
import { getSupabase as _getSupabase } from './supabaseClient';
import { fetchNextSeq, fetchLastAnchor, fetchTransaction } from './aptosClient';
import { startTradeExecutorWorker } from './tradeExecutorWorker';
import { startExecutionReconciliationWorker } from './reconciliationWorker';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// When using Supabase with an anon key system, schema should already exist.
// Remove the old ensureSchema logic; rely on migrations / SQL in Supabase.

// Simple API endpoint to check if the server is running
app.get('/api/health', (req: express.Request, res: express.Response) => {
  res.status(200).json({ status: 'OK' });
});

// Manual maintenance trigger (protected in future by auth token)
app.post('/api/admin/maintenance/cleanup-nonces', async (_req, res) => {
  try {
    const result = await cleanupExpiredNonces();
    return respondSuccess(res, { deleted: result.deleted });
  } catch (e) {
    return respondError(res, { code: 'MAINTENANCE_ERROR', message: 'Cleanup failed' }, 500);
  }
});

// --- On-chain (Aptos) integration stubs ---
app.post('/api/trader/onchain/register', async (req, res) => {
  const { traderId, aptosAddress } = req.body || {};
  if (!traderId || !aptosAddress) return respondError(res, { code: 'VALIDATION', message: 'traderId & aptosAddress required' });
  try {
    await ensureUser(Number(traderId));
    await ensureTrader(Number(traderId));
    const supabase = getSupabase();
    const { error } = await supabase.from('traders').update({ aptos_address: aptosAddress, onchain_enabled: true }).eq('telegram_user_id', traderId);
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    return respondSuccess(res, { message: 'On-chain trader linked' });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

app.get('/api/trader/onchain/:traderId/next-seq', async (req, res) => {
  const traderId = Number(req.params.traderId);
  if (Number.isNaN(traderId)) return respondError(res, { code: 'VALIDATION', message: 'invalid traderId' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('traders').select('aptos_address').eq('telegram_user_id', traderId).maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!data?.aptos_address) return respondError(res, { code: 'NOT_ONCHAIN', message: 'Trader not on-chain' }, 404);
    const nextSeq = await fetchNextSeq(data.aptos_address);
    return respondSuccess(res, { nextSeq });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// New endpoint: combined on-chain status
app.get('/api/trader/:traderId/onchain/status', async (req, res) => {
  const traderId = Number(req.params.traderId);
  if (Number.isNaN(traderId)) return respondError(res, { code: 'VALIDATION', message: 'invalid traderId' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('traders').select('aptos_address,last_onchain_seq').eq('telegram_user_id', traderId).maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!data?.aptos_address) return respondError(res, { code: 'NOT_ONCHAIN', message: 'Trader not on-chain' }, 404);
    const chainNext = await fetchNextSeq(data.aptos_address);
    const lastAnchor = await fetchLastAnchor(data.aptos_address);
    const dbLast = data.last_onchain_seq || 0;
    const chainLast = chainNext > 0 ? chainNext - 1 : 0;
    const diverged = chainLast !== dbLast;
    return respondSuccess(res, { traderId, aptosAddress: data.aptos_address, chainNext, chainLast, dbLast, diverged, lastAnchor });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Anchor status endpoint
app.get('/api/anchor/:signalId', async (req, res) => {
  const signalId = Number(req.params.signalId);
  if (Number.isNaN(signalId)) return respondError(res, { code: 'VALIDATION', message: 'invalid signalId' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('anchored_signals').select('id, signal_id, seq, tx_hash, status, payload_hash, created_at').eq('signal_id', signalId).maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!data) return respondError(res, { code: 'NOT_FOUND', message: 'No anchor row' }, 404);
    return respondSuccess(res, { anchor: data });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Verify an anchor's on-chain event payload hash (best-effort)
app.get('/api/anchor/:signalId/verify', async (req, res) => {
  const signalId = Number(req.params.signalId);
  if (Number.isNaN(signalId)) return respondError(res, { code: 'VALIDATION', message: 'invalid signalId' });
  try {
    const supabase = getSupabase();
    const { data: anchorRow, error: aErr } = await supabase.from('anchored_signals')
      .select('id, signal_id, tx_hash, payload_hash, seq, status')
      .eq('signal_id', signalId)
      .maybeSingle();
    if (aErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!anchorRow) return respondError(res, { code: 'NOT_FOUND', message: 'Anchor not found' }, 404);
  if (!anchorRow.tx_hash) return respondSuccess(res, { verified: false, reason: 'NO_TX_HASH', anchor: anchorRow });
    const tx = await fetchTransaction(anchorRow.tx_hash);
    if (!tx) return respondSuccess(res, { verified: false, reason: 'TX_NOT_FOUND', anchor: anchorRow });
    // Attempt to locate event with matching hash bytes (payload_hash stored hex without 0x maybe)
    const want = anchorRow.payload_hash.startsWith('0x') ? anchorRow.payload_hash.toLowerCase() : '0x' + anchorRow.payload_hash.toLowerCase();
    let matchEvent: any = null;
    if (Array.isArray((tx as any).events)) {
      for (const ev of (tx as any).events) {
        const data = (ev as any).data;
        if (data && data.payload_hash) {
          // Some SDKs may hex encode already
          const candidate = String(data.payload_hash).toLowerCase();
            if (candidate === want) { matchEvent = ev; break; }
        } else if (data && data.hash_bytes) {
          // fallback: convert array of numbers to hex
          try {
            const arr: number[] = data.hash_bytes;
            const hex = '0x' + Buffer.from(arr).toString('hex');
            if (hex.toLowerCase() === want) { matchEvent = ev; break; }
          } catch {}
        }
      }
    }
    const verified = !!matchEvent;
    // Persist verification outcome
    const update: any = { verification_status: verified ? 'verified' : 'mismatch' };
    if (verified) update.verified_at = new Date().toISOString();
    const { error: upErr } = await supabase.from('anchored_signals').update(update).eq('id', anchorRow.id);
    if (upErr) logger.warn({ id: anchorRow.id, err: upErr }, 'anchor.verify.update.warn');
    return respondSuccess(res, { verified, anchor: { ...anchorRow, ...update }, txFound: true, matchedEvent: verified ? matchEvent : null });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// On-chain debug: fetch raw transaction
app.get('/api/tx/:txHash', async (req, res) => {
  const txHash = req.params.txHash;
  if (!/^0x[0-9a-fA-F]+$/.test(txHash)) return respondError(res, { code: 'VALIDATION', message: 'invalid tx hash' });
  try {
    const tx = await fetchTransaction(txHash);
    if (!tx) return respondError(res, { code: 'NOT_FOUND', message: 'Transaction not found' }, 404);
    return respondSuccess(res, { tx });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// List recent anchors (default 20)
app.get('/api/anchors/recent', async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('anchored_signals')
      .select('id, signal_id, seq, tx_hash, status, payload_hash, created_at')
      .order('id', { ascending: false })
      .limit(limit);
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    return respondSuccess(res, { anchors: data });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Return canonical hash of a signal payload for external verification
app.get('/api/signal/:id/hash', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return respondError(res, { code: 'VALIDATION', message: 'invalid id' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('signals').select('id, payload').eq('id', id).maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!data) return respondError(res, { code: 'NOT_FOUND', message: 'Signal not found' }, 404);
    const h = hashPayload(data.payload);
    return respondSuccess(res, { signalId: id, hash: h });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// TODO: Implement all the other necessary endpoints
// For now, we'll just log the requests to show it's working

// Ensure user & trader helper
app.use(globalLimiter);
app.use(requestIdMiddleware);
// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = (req as any).requestId;
  const log = childLogger({ reqId });
  log.info({ method: req.method, url: req.originalUrl }, 'request.start');
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    (logger as any)[level]({ reqId, status: res.statusCode, duration }, 'request.end');
  });
  next();
});
async function ensureUser(telegram_user_id: number, username?: string | null) {
  const supabase = getSupabase();
  const { error } = await supabase.from('users')
    .upsert({ telegram_user_id, telegram_username: username || null }, { onConflict: 'telegram_user_id' });
  if (error) throw new Error('user_upsert_failed');
}

async function ensureTrader(trader_id: number) {
  const supabase = getSupabase();
  // Check if trader exists in traders; if not, create inert record (could require permission later)
  const { data, error } = await supabase.from('traders').select('telegram_user_id').eq('telegram_user_id', trader_id).maybeSingle();
  if (error) throw new Error('trader_lookup_failed');
  if (!data) {
    const { error: insErr } = await supabase.from('traders').insert({ telegram_user_id: trader_id });
    if (insErr) throw new Error('trader_insert_failed');
  }
}

app.post('/api/follow', followLimiter, async (req: express.Request, res: express.Response) => {
  const parsed = parse(followRequestSchema, req.body);
  if (parsed.error) return respondError(res, { code: 'VALIDATION', message: parsed.error });
  const { userId, traderToFollow } = parsed.data!;
  try {
    await ensureUser(userId);
    await ensureUser(traderToFollow);
    await ensureTrader(traderToFollow);
    const supabase = getSupabase();
    const { error } = await supabase.from('follows').insert({ follower_id: userId, trader_id: traderToFollow });
    if (error) {
      if ((error as any).code === '23505') {
        return respondSuccess(res, { message: 'Already following' });
      }
      console.error('follow insert error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { message: 'Followed' }, 201);
  } catch (e: any) {
    if (e.message && e.message.endsWith('_failed')) {
      return respondError(res, { code: 'UPSERT_FAILED', message: e.message }, 500);
    }
    console.error('follow error', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

app.post('/api/unfollow', followLimiter, async (req: express.Request, res: express.Response) => {
  const parsed = parse(unfollowSchema, req.body);
  if (parsed.error) return respondError(res, { code: 'VALIDATION', message: parsed.error });
  const { userId, traderId } = parsed.data!;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('follows')
      .delete()
      .eq('follower_id', userId)
      .eq('trader_id', traderId);
    if (error) {
      console.error('unfollow error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { message: 'Unfollowed (if existed)' });
  } catch (e) {
    console.error('unfollow internal', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

app.get('/api/follows/:telegramUserId', async (req: express.Request, res: express.Response) => {
  const id = Number(req.params.telegramUserId);
  if (Number.isNaN(id)) return respondError(res, { code: 'VALIDATION', message: 'invalid_user_id' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('follows')
      .select('trader_id, created_at')
      .eq('follower_id', id)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('follows list error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { follows: data });
  } catch (e) {
    console.error('follows list internal', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

app.post('/api/settings', async (req: express.Request, res: express.Response) => {
  const parsed = parse(settingsUpdateSchema, req.body);
  if (parsed.error) return respondError(res, { code: 'VALIDATION', message: parsed.error });
  const { userId, tradeAmount, riskMultiplier, notifySignals } = parsed.data!;
  try {
    await ensureUser(userId);
    const supabase = getSupabase();
    const update: any = { updated_at: new Date().toISOString() };
    if (tradeAmount !== undefined) update.trade_amount_numeric = tradeAmount;
    if (riskMultiplier !== undefined) update.risk_multiplier = riskMultiplier;
    if (notifySignals !== undefined) update.notify_signals = notifySignals;
    const { error } = await supabase
      .from('user_settings')
      .upsert({ telegram_user_id: userId, ...update }, { onConflict: 'telegram_user_id' });
    if (error) {
      console.error('settings upsert error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { message: 'Settings saved' });
  } catch (e) {
    console.error('settings internal', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

app.get('/api/settings/:telegramUserId', async (req: express.Request, res: express.Response) => {
  const id = Number(req.params.telegramUserId);
  if (Number.isNaN(id)) return respondError(res, { code: 'VALIDATION', message: 'invalid_user_id' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_settings')
      .select('trade_amount_numeric, risk_multiplier, notify_signals, updated_at')
      .eq('telegram_user_id', id)
      .maybeSingle();
    if (error) {
      console.error('settings fetch error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    if (!data) return respondSuccess(res, { settings: null });
    return respondSuccess(res, { settings: data });
  } catch (e) {
    console.error('settings fetch internal', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});


// --- SIGNAL BROADCAST (Step 3) ---
// Simplified auth: ensure trader exists; future: require verified wallet or admin flag.
app.post('/api/signal', signalLimiter, async (req: express.Request, res: express.Response) => {
  // Normalize legacy / flexible client payload fields before schema validation
  const body = { ...req.body };
  if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
    const p: any = body.payload;
    // Symbol aliases
    if (!p.symbol && p.pair) p.symbol = p.pair;
    if (!p.symbol && p.asset) p.symbol = p.asset;
    // Entry price aliases
    if (p.price !== undefined && p.entry === undefined) p.entry = p.price;
    if (p.entryPrice !== undefined && p.entry === undefined) p.entry = p.entryPrice;
    // Side normalization & synonyms
    if (typeof p.side === 'string') {
      const raw = p.side.trim().toUpperCase();
      const map: Record<string,string> = { 'BUY':'BUY','SELL':'SELL','LONG':'LONG','SHORT':'SHORT','L':'LONG','S':'SHORT' };
      if (map[raw]) p.side = map[raw]; else p.side = raw; // let schema catch invalid
    }
    // Move trailing ts into metadata to avoid schema rejection
    if (p.ts !== undefined) {
      p.metadata = { ...(p.metadata||{}), ts: p.ts };
      delete p.ts;
    }
    // Remove stray fields that might conflict (price, pair, asset after mapping)
    // Keep them in metadata for audit if desired
    const extras: any = {};
    for (const k of ['price','pair','asset','entryPrice']) {
      if (p[k] !== undefined) { extras[k] = p[k]; delete p[k]; }
    }
    if (Object.keys(extras).length) {
      p.metadata = { ...(p.metadata||{}), legacy: extras };
    }
    body.payload = p;
  }
  const parsed = parse(signalRequestSchema, body);
  if (parsed.error) return respondError(res, { code: 'VALIDATION', message: parsed.error });
  const { traderId, payload: signalPayload } = parsed.data!;
  try {
    await ensureUser(traderId);
    await ensureTrader(traderId);
    const supabase = getSupabase();
    // Enforce that trader has a verified wallet before broadcasting
    const bypassWallet = process.env.DEV_SKIP_WALLET_VERIFY === '1';
    const { data: walletRow, error: walletErr } = await supabase
      .from('user_wallets')
      .select('address, verified_at')
      .eq('telegram_user_id', traderId)
      .maybeSingle();
    if (walletErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!bypassWallet && (!walletRow || !walletRow.verified_at || !walletRow.address)) {
      return respondError(res, { code: 'TRADER_UNVERIFIED', message: 'Trader wallet not verified' }, 403);
    }
    if (bypassWallet && (!walletRow || !walletRow.verified_at || !walletRow.address)) {
      logger.warn({ traderId }, 'wallet.verify.bypassed');
    }
    const { data: inserted, error: insertErr } = await supabase
      .from('signals')
      .insert({ trader_id: traderId, payload: signalPayload })
      .select('id, created_at')
      .maybeSingle();
    if (insertErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    const signalId = inserted?.id;
    // Phase 1: extract actionable trade intent if present
    if (signalId && (signalPayload as any).intent) {
      const intent = (signalPayload as any).intent;
      // Basic validation: require action, market, sizeMode, sizeValue if intent provided
      if (intent.action && intent.market && intent.sizeMode && intent.sizeValue) {
        // Normalize action to upper-case canonical set
        const act = String(intent.action).toUpperCase();
        // Derive intent hash (simple canonical JSON for now)
        const intentCanonical = {
          action: act,
          market: intent.market,
          size_mode: intent.sizeMode,
            size_value: intent.sizeValue,
          max_slippage_bps: intent.maxSlippageBps || null,
          deadline_ts: intent.deadlineTs || null
        };
        // Reuse payload hashing to keep deterministic
        const h = hashPayload(intentCanonical);
        const { error: tiErr } = await supabase.from('trade_intents').insert({
          signal_id: signalId,
          action: act,
          market: intent.market,
          size_mode: intent.sizeMode,
          size_value: intent.sizeValue,
          max_slippage_bps: intent.maxSlippageBps || null,
          deadline_ts: intent.deadlineTs || null,
          intent_hash: h
        });
        if (tiErr) logger.warn({ signalId, err: tiErr }, 'trade_intent.insert.warn');
      } else {
        logger.warn({ signalId }, 'trade_intent.incomplete.ignore');
      }
    }
    const { data: followers, error: fErr } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('trader_id', traderId);
    if (fErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    const followerIds = followers?.map(f => f.follower_id) || [];
    // If trader is on-chain enabled, enqueue anchoring
    const { data: traderRow } = await supabase.from('traders').select('onchain_enabled').eq('telegram_user_id', traderId).maybeSingle();
    if (traderRow?.onchain_enabled && inserted?.id) {
      const h = hashPayload(signalPayload);
      const { error: anchorErr } = await supabase.from('anchored_signals').insert({ signal_id: inserted.id, status: 'pending', payload_hash: h });
      if (anchorErr) console.error('anchor enqueue error', anchorErr);
    }
    // Enqueue deliveries with status queued
    if (followerIds.length) {
      const { error: delErr } = await supabase.from('signal_deliveries').insert(
        followerIds.map(fid => ({ signal_id: signalId, follower_id: fid, status: 'queued', next_attempt_at: new Date().toISOString() }))
      );
      if (delErr) console.error('deliveries enqueue error', delErr);
    }
    return respondSuccess(res, { message: 'Signal enqueued for delivery', signalId, followerCount: followerIds.length }, 201);
  } catch (e) {
    console.error('signal broadcast internal', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// List signals (recent) optionally by traderId
app.get('/api/signals', async (req: express.Request, res: express.Response) => {
  const traderId = req.query.traderId ? Number(req.query.traderId) : undefined;
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 20;
  if (traderId !== undefined && Number.isNaN(traderId)) {
    return respondError(res, { code: 'VALIDATION', message: 'invalid_trader_id' });
  }
  try {
    const supabase = getSupabase();
    let query = supabase.from('signals').select('id, trader_id, payload, created_at').order('created_at', { ascending: false }).limit(limit);
    if (traderId) query = query.eq('trader_id', traderId);
    const { data, error } = await query;
    if (error) {
      console.error('signals list error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { signals: data });
  } catch (e) {
    console.error('signals list internal', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Phase 2: list trade intents (recent)
app.get('/api/trade-intents/recent', async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('trade_intents')
      .select('id, signal_id, action, market, size_mode, size_value, max_slippage_bps, deadline_ts, intent_hash, created_at')
      .order('id', { ascending: false })
      .limit(limit);
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    return respondSuccess(res, { tradeIntents: data });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Phase 2: get single trade intent
app.get('/api/trade-intent/:signalId', async (req, res) => {
  const signalId = Number(req.params.signalId);
  if (Number.isNaN(signalId)) return respondError(res, { code: 'VALIDATION', message: 'invalid signalId' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('trade_intents')
      .select('id, signal_id, action, market, size_mode, size_value, max_slippage_bps, deadline_ts, intent_hash, created_at')
      .eq('signal_id', signalId)
      .maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!data) return respondError(res, { code: 'NOT_FOUND', message: 'No trade intent' }, 404);
    return respondSuccess(res, { tradeIntent: data });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Phase 2: executed trades list (recent)
app.get('/api/executed-trades/recent', async (req, res) => {
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('executed_trades')
  .select('id, trade_intent_id, signal_id, status, tx_hash, size_value, slippage_bps, error, created_at, executed_at, intent_hash, anchor_id, payload_hash, plan_hash, follower_count, onchain_verified, onchain_event_ts, onchain_event_version, onchain_event_tx_hash, attempts, next_attempt_at')
      .order('id', { ascending: false })
      .limit(limit);
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    return respondSuccess(res, { executed: data });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

app.get('/api/executed-trade/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return respondError(res, { code: 'VALIDATION', message: 'invalid id' });
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('executed_trades')
  .select('id, trade_intent_id, signal_id, status, tx_hash, size_value, slippage_bps, error, created_at, executed_at, intent_hash, anchor_id, payload_hash, plan_hash, follower_count, onchain_verified, onchain_event_ts, onchain_event_version, onchain_event_tx_hash, attempts, next_attempt_at')
      .eq('id', id)
      .maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!data) return respondError(res, { code: 'NOT_FOUND', message: 'Not found' }, 404);
    return respondSuccess(res, { executed: data });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Verify (reconcile) a specific executed trade by intent hash against recent on-chain events
app.get('/api/executed-trade/:id/verify', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return respondError(res, { code: 'VALIDATION', message: 'invalid id' });
  try {
    const supabase = getSupabase();
    const { data: row, error } = await supabase.from('executed_trades').select('id, intent_hash, onchain_verified').eq('id', id).maybeSingle();
    if (error) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!row) return respondError(res, { code: 'NOT_FOUND', message: 'Not found' }, 404);
    // Lightweight: trigger reconciliation cycle logic by marking row for verification (set onchain_verified NULL)
    if (row.onchain_verified === false) {
      const { error: upErr } = await supabase.from('executed_trades').update({ onchain_verified: null }).eq('id', id);
      if (upErr) logger.warn({ id, err: upErr }, 'exec.verify.reset.warn');
    }
    return respondSuccess(res, { queued: true });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// Basic metrics (Step 3): aggregated counts & slippage distribution (simple query approach)
app.get('/api/metrics', async (_req, res) => {
  try {
    const supabase = getSupabase();
    // Parallel-ish queries (sequential to keep simple; could optimize later)
    const { data: execRecent } = await supabase.rpc ? { data: null } : { data: null }; // placeholder if using RPC later
    const { data: counts, error: cErr } = await supabase
      .from('executed_trades')
      .select('status, onchain_verified, error, slippage_bps, plan_hash, id, onchain_event_version', { count: 'exact', head: false })
      .order('id', { ascending: false })
      .limit(500);
    if (cErr) return respondError(res, { code: 'DB_ERROR', message: 'metrics query failed' }, 500);
    const total = counts?.length || 0;
    let executed = 0, failed = 0, pending = 0, simulated = 0;
    let verified = 0, mismatches = 0;
    const slippages: number[] = [];
    for (const r of counts || []) {
      switch (r.status) { case 'executed': executed++; break; case 'failed': failed++; break; case 'pending': pending++; break; case 'simulated': simulated++; break; }
      if (r.onchain_verified) verified++; else if (r.error === 'PLAN_HASH_MISMATCH') mismatches++;
      if (typeof r.slippage_bps === 'number') slippages.push(r.slippage_bps);
    }
    slippages.sort((a,b)=>a-b);
    const slipCount = slippages.length;
    const slipAvg = slipCount ? slippages.reduce((a,b)=>a+b,0)/slipCount : 0;
    const p = (q: number) => slipCount ? slippages[Math.min(slipCount-1, Math.floor(q*slipCount))] : 0;
    return respondSuccess(res, {
      executedTrades: { total, executed, simulated, pending, failed, verified, planHashMismatches: mismatches },
      slippage: { count: slipCount, avg_bps: Number(slipAvg.toFixed(2)), p50: p(0.5), p90: p(0.9), p99: p(0.99) }
    });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'metrics internal error' }, 500);
  }
});

// Unified full signal view: combines signal payload, trade intent, anchor, executed trade (if any)
app.get('/api/signal/:id/full', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return respondError(res, { code: 'VALIDATION', message: 'invalid id' });
  try {
    const supabase = getSupabase();
    const { data: signalRow, error: sErr } = await supabase
      .from('signals')
      .select('id, trader_id, payload, created_at')
      .eq('id', id)
      .maybeSingle();
    if (sErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    if (!signalRow) return respondError(res, { code: 'NOT_FOUND', message: 'Signal not found' }, 404);
    const { data: intentRow } = await supabase
      .from('trade_intents')
      .select('id, action, market, size_mode, size_value, max_slippage_bps, deadline_ts, intent_hash, created_at')
      .eq('signal_id', id)
      .maybeSingle();
    const { data: anchorRow } = await supabase
      .from('anchored_signals')
      .select('id, status, tx_hash, payload_hash, seq, verification_status, verified_at')
      .eq('signal_id', id)
      .maybeSingle();
    const { data: execRow } = await supabase
      .from('executed_trades')
      .select('id, status, tx_hash, size_value, slippage_bps, error, created_at, executed_at, intent_hash, anchor_id, payload_hash, plan_hash, follower_count, onchain_verified, onchain_event_ts, onchain_event_version, onchain_event_tx_hash')
      .eq('signal_id', id)
      .maybeSingle();
    return respondSuccess(res, { signal: signalRow, intent: intentRow || null, anchor: anchorRow || null, execution: execRow || null });
  } catch (e) {
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// ---------------- WALLET CONNECT FLOW ----------------
// 1. Request challenge (nonce)
app.post('/api/wallet/challenge', walletLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const { telegramUserId } = req.body;
    if (telegramUserId === undefined || telegramUserId === null) return respondError(res, { code: 'VALIDATION', message: 'telegramUserId required' });
    const numericId = Number(telegramUserId);
    if (Number.isNaN(numericId)) return respondError(res, { code: 'VALIDATION', message: 'telegramUserId must be a number' });
    // Ensure user row exists for FK integrity
    try {
      await ensureUser(numericId);
    } catch (e) {
      console.error('ensureUser (wallet challenge) failed', e);
      return respondError(res, { code: 'USER_UPSERT_FAILED', message: 'Could not ensure user' }, 500);
    }
    const nonce = randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minute validity
    const supabase = getSupabase();
    const { error } = await supabase
      .from('user_wallets')
      .upsert({ telegram_user_id: numericId, nonce, nonce_expires_at: expires, address: null, verified_at: null }, { onConflict: 'telegram_user_id' });
    if (error) {
      console.error('Supabase upsert error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { nonce, messageToSign: `SignalFi Wallet Verification: ${nonce}`, expiresAt: expires });
  } catch (e) {
    console.error('Wallet challenge error', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// 2. Verify signature
app.post('/api/wallet/verify', walletLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const { telegramUserId, address, signature } = req.body;
    if (telegramUserId === undefined || telegramUserId === null || !address || !signature) {
      return respondError(res, { code: 'VALIDATION', message: 'telegramUserId, address, signature required' });
    }
    const numericId = Number(telegramUserId);
    if (Number.isNaN(numericId)) return respondError(res, { code: 'VALIDATION', message: 'telegramUserId must be a number' });
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from('user_wallets')
      .select('nonce, nonce_expires_at')
      .eq('telegram_user_id', numericId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('Supabase select error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    if (!rows || !rows.nonce) {
      return respondError(res, { code: 'NO_ACTIVE_CHALLENGE', message: 'No active challenge' });
    }
    if (rows.nonce_expires_at && Date.now() > new Date(rows.nonce_expires_at).getTime()) {
      return respondError(res, { code: 'NONCE_EXPIRED', message: 'Challenge expired, request a new one' });
    }
    const nonce: string = rows.nonce;
    const message = `SignalFi Wallet Verification: ${nonce}`;
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch (verifyErr) {
      return respondError(res, { code: 'INVALID_SIGNATURE', message: 'Invalid signature' });
    }
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return respondError(res, { code: 'ADDRESS_MISMATCH', message: 'Recovered address mismatch', details: { recovered } });
    }
    const { error: updateErr } = await supabase
      .from('user_wallets')
      .update({ address: recovered, verified_at: new Date().toISOString(), nonce: null, nonce_expires_at: null })
      .eq('telegram_user_id', numericId);
    if (updateErr) {
      console.error('Supabase update error', updateErr);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { success: true, address: recovered });
  } catch (e) {
    console.error('Wallet verify error', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// 3. Status endpoint
app.get('/api/wallet/status/:telegramUserId', async (req: express.Request, res: express.Response) => {
  try {
    const telegramUserId = req.params.telegramUserId;
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_wallets')
      .select('address, verified_at')
      .eq('telegram_user_id', telegramUserId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('Supabase status select error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    if (!data) return respondSuccess(res, { connected: false });
    return respondSuccess(res, { connected: !!data.verified_at && !!data.address, address: data.address, verified_at: data.verified_at });
  } catch (e) {
    console.error('Wallet status error', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;

// Error middleware should be last
app.use(errorMiddleware);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Backend server started');
  scheduleNonceCleanup();
  startDeliveryWorker();
  startAnchorWorker();
  startTradeExecutorWorker();
  startExecutionReconciliationWorker();
  // Periodic reconciliation (every 5 minutes)
  const reconMs = Number(process.env.ONCHAIN_RECON_INTERVAL_MS || 300000);
  setInterval(async () => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from('traders').select('telegram_user_id, aptos_address, last_onchain_seq').eq('onchain_enabled', true).limit(200);
      if (error) { logger.error({ err: error }, 'recon.fetch.error'); return; }
      if (!data) return;
      for (const t of data) {
        if (!t.aptos_address) continue;
        try {
          const nextSeq = await fetchNextSeq(t.aptos_address);
          const chainLast = nextSeq > 0 ? nextSeq - 1 : 0;
          if (chainLast !== (t.last_onchain_seq || 0)) {
            const { error: upErr } = await supabase.from('traders').update({ last_onchain_seq: chainLast }).eq('telegram_user_id', t.telegram_user_id);
            if (upErr) logger.error({ trader: t.telegram_user_id, err: upErr }, 'recon.update.error');
          }
        } catch (inner) {
          logger.warn({ trader: t.telegram_user_id, err: (inner as any)?.message }, 'recon.trader.error');
        }
      }
    } catch (e) {
      logger.error({ err: e }, 'recon.cycle.error');
    }
  }, reconMs).unref();
});
