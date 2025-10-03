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

// TODO: Implement all the other necessary endpoints
// For now, we'll just log the requests to show it's working

// Ensure user & trader helper
app.use(globalLimiter);
app.use(requestIdMiddleware);
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
  const parsed = parse(signalRequestSchema, req.body);
  if (parsed.error) return respondError(res, { code: 'VALIDATION', message: parsed.error });
  const { traderId, payload: signalPayload } = parsed.data!;
  try {
    await ensureUser(traderId);
    await ensureTrader(traderId);
    const supabase = getSupabase();
    const { data: inserted, error: insertErr } = await supabase
      .from('signals')
      .insert({ trader_id: traderId, payload: signalPayload })
      .select('id, created_at')
      .maybeSingle();
    if (insertErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    const signalId = inserted?.id;
    const { data: followers, error: fErr } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('trader_id', traderId);
    if (fErr) return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    const followerIds = followers?.map(f => f.follower_id) || [];
    const text = formatSignalMessage(traderId, signalPayload);
    const deliveries: { follower_id: number; status: string; signal_id: number }[] = [];
    for (const fid of followerIds) {
      let status: string = 'delivered';
      const ok = await sendTelegramMessage(fid, text);
      if (!ok) status = 'failed';
      deliveries.push({ follower_id: fid, status, signal_id: signalId });
    }
    if (deliveries.length) {
      const { error: delErr } = await supabase.from('signal_deliveries').insert(
        deliveries.map(d => ({ signal_id: d.signal_id, follower_id: d.follower_id, status: d.status }))
      );
      if (delErr) console.error('deliveries insert error', delErr);
    }
    const deliveredCount = deliveries.filter(d => d.status === 'delivered').length;
    const failedCount = deliveries.filter(d => d.status === 'failed').length;
    return respondSuccess(res, { message: 'Signal broadcast complete', signalId, followerCount: followerIds.length, delivered: deliveredCount, failed: failedCount }, 201);
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

// ---------------- WALLET CONNECT FLOW ----------------
// 1. Request challenge (nonce)
app.post('/api/wallet/challenge', walletLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const { telegramUserId } = req.body;
    if (!telegramUserId) return respondError(res, { code: 'VALIDATION', message: 'telegramUserId required' });
    const nonce = randomBytes(16).toString('hex');
    const supabase = getSupabase();
    const { error } = await supabase
      .from('user_wallets')
      .upsert({ telegram_user_id: telegramUserId, nonce, address: null, verified_at: null }, { onConflict: 'telegram_user_id' });
    if (error) {
      console.error('Supabase upsert error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    return respondSuccess(res, { nonce, messageToSign: `SignalFi Wallet Verification: ${nonce}` });
  } catch (e) {
    console.error('Wallet challenge error', e);
    return respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
  }
});

// 2. Verify signature
app.post('/api/wallet/verify', walletLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const { telegramUserId, address, signature } = req.body;
    if (!telegramUserId || !address || !signature) {
      return respondError(res, { code: 'VALIDATION', message: 'telegramUserId, address, signature required' });
    }
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from('user_wallets')
      .select('nonce')
      .eq('telegram_user_id', telegramUserId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('Supabase select error', error);
      return respondError(res, { code: 'DB_ERROR', message: 'Database error' }, 500);
    }
    if (!rows || !rows.nonce) {
      return respondError(res, { code: 'NO_ACTIVE_CHALLENGE', message: 'No active challenge' });
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
      .update({ address: recovered, verified_at: new Date().toISOString(), nonce: null })
      .eq('telegram_user_id', telegramUserId);
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
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
