// src/bot.ts
import { Bot, Keyboard } from "grammy";
import * as dotenv from "dotenv";
import axios from 'axios';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in the .env file!");
}

const API_BASE_URL = (process.env.BACKEND_BASE_URL || 'http://localhost:3000') + '/api';

const bot = new Bot(token);

// --- Instrumentation for debugging startup & silent failures ---
// Log bot identity on startup and basic environment hints
(async () => {
  try {
    const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then(r => r.json());
    console.log('[bot:init] getMe response:', me);
  } catch (e) {
    console.error('[bot:init] getMe failed', e);
  }
})();

// Global error catcher so failures are visible
bot.catch(err => {
  console.error('[bot:error]', err.error || err);
});

// Log each incoming update (can be verbose; disable later if noisy)
bot.use(async (ctx, next) => {
  try {
    const kind = Object.keys(ctx.update).filter(k => k !== 'update_id').join(',');
    console.log('[bot:update]', { update_id: (ctx.update as any).update_id, kind, from: ctx.from?.id, text: (ctx.message as any)?.text });
  } catch (e) {
    console.error('[bot:update.log.error]', e);
  }
  return next();
});

const mainMenu = new Keyboard()
  .text("/positions").row()
  .text("My Settings")
  .text("Connect Wallet")
  .resized();

bot.command("start", async (ctx: any) => {
  await ctx.reply("Welcome to SignalFi! Your settings are now saved permanently.", {
    reply_markup: mainMenu,
  });
});

// Simple health / ping command to verify responsiveness
bot.command('ping', async (ctx: any) => {
  const t0 = Date.now();
  const msg = await ctx.reply('pong');
  const dt = Date.now() - t0;
  console.log('[bot:ping]', { from: ctx.from?.id, latency_ms: dt, message_id: msg.message_id });
});

// Convenience command to display numeric Telegram user ID
bot.command('id', async (ctx: any) => {
  if (!ctx.from) return;
  await ctx.reply(`Your Telegram numeric ID: ${ctx.from.id}`);
});

// Refactored command to call the backend
bot.command("follow", async (ctx: any) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const raw = ctx.match?.trim();
  if (!raw) {
    return ctx.reply("Usage: /follow <traderId>");
  }
  const traderToFollow = Number(raw);
  if (Number.isNaN(traderToFollow)) {
    return ctx.reply("Trader ID must be a number.");
  }
  try {
    const resp = await axios.post(`${API_BASE_URL}/follow`, { userId, traderToFollow });
    if (resp.data?.message === 'Already following') {
      await ctx.reply(`ℹ️ You already follow ${traderToFollow}.`);
    } else {
      await ctx.reply(`✅ Now following ${traderToFollow}.`);
    }
  } catch (error: any) {
    const code = error?.response?.data?.error?.code;
    const msg = error?.response?.data?.error?.message;
    if (code === 'VALIDATION') {
      return ctx.reply(`Validation failed: ${msg}`);
    }
    if (code === 'DB_ERROR') {
      return ctx.reply('Database error while following. Try again later.');
    }
    console.error("/follow command error", error?.response?.data || error);
    await ctx.reply("Follow failed (unexpected error).");
  }
});

// /unfollow <traderId>
bot.command('unfollow', async (ctx: any) => {
  if (!ctx.from) return;
  const traderId = ctx.match;
  if (!traderId) return ctx.reply('Usage: /unfollow <traderId>');
  try {
    await axios.post(`${API_BASE_URL}/unfollow`, { userId: ctx.from.id, traderId: Number(traderId) });
    await ctx.reply(`🛑 Unfollowed ${traderId} (if previously following).`);
  } catch (e) {
    console.error('unfollow error', e);
    await ctx.reply('Failed to unfollow.');
  }
});

// /list - list current follows
bot.command('list', async (ctx: any) => {
  if (!ctx.from) return;
  try {
    const resp = await axios.get(`${API_BASE_URL}/follows/${ctx.from.id}`);
    const follows = resp.data.follows as { trader_id: number; created_at: string }[];
    if (!follows || follows.length === 0) return ctx.reply('You are not following any traders. Use /follow <id>.');
    const lines = follows.map(f => `• ${f.trader_id} (since ${new Date(f.created_at).toLocaleDateString()})`).join('\n');
    await ctx.reply(`Following:\n${lines}`);
  } catch (e) {
    console.error('list follows error', e);
    await ctx.reply('Could not fetch follows.');
  }
});

// /settings [tradeAmount] [riskMultiplier] [notify(yes/no)]
bot.command('settings', async (ctx: any) => {
  if (!ctx.from) return;
  const args = ctx.match?.trim() ? ctx.match.trim().split(/\s+/) : [];
  if (args.length === 0) {
    // fetch current settings
    try {
      const resp = await axios.get(`${API_BASE_URL}/settings/${ctx.from.id}`);
      if (!resp.data.settings) return ctx.reply('No settings saved yet. Use /settings <amount> <riskMultiplier> <yes|no>');
      const s = resp.data.settings;
      return ctx.reply(`Settings:\nTrade Amount: ${s.trade_amount_numeric || 'N/A'}\nRisk Multiplier: ${s.risk_multiplier}\nNotify Signals: ${s.notify_signals ? 'Yes' : 'No'}`);
    } catch (e) {
      console.error('fetch settings error', e);
      return ctx.reply('Could not fetch settings.');
    }
  }
  if (args.length < 3) {
    return ctx.reply('Usage: /settings <tradeAmount> <riskMultiplier> <notify yes|no>');
  }
  const [tradeAmount, riskMultiplier, notifyRaw] = args;
  const notifySignals = /^y(es)?$/i.test(notifyRaw) ? true : /^n(o)?$/i.test(notifyRaw) ? false : undefined;
  if (notifySignals === undefined) return ctx.reply('Notify must be yes or no.');
  try {
    await axios.post(`${API_BASE_URL}/settings`, { userId: ctx.from.id, tradeAmount, riskMultiplier, notifySignals });
    await ctx.reply('✅ Settings updated. Use /settings to view.');
  } catch (e) {
    console.error('update settings error', e);
    await ctx.reply('Failed to update settings.');
  }
});

// -------------- WALLET CONNECT FLOW --------------
// /connectwallet -> request challenge from backend and show message to sign
bot.command("connectwallet", async (ctx: any) => {
  if (!ctx.from) return;
  try {
    const telegramUserId = ctx.from.id;
    const resp = await axios.post(`${API_BASE_URL}/wallet/challenge`, { telegramUserId });
    const { messageToSign, nonce } = resp.data;
    await ctx.reply(
      `Wallet Connect Step 1\n--------------------------------\nSign the following message with the wallet you want to link:\n\n${messageToSign}\n\nThen run:\n/verifywallet <address> <signature>\n\nExample:\n/verifywallet 0xYourAddress 0xSignature...\n\nNonce: ${nonce}`
    );
  } catch (e) {
    console.error('connectwallet error', e);
    await ctx.reply('Failed to create wallet challenge. Please try again later.');
  }
});

// Support tapping the keyboard button text
bot.hears('Connect Wallet', async (ctx: any) => ctx.api.sendMessage(ctx.chat.id, 'Use /connectwallet to start the linking process.'));

// /verifywallet <address> <signature>
bot.command("verifywallet", async (ctx: any) => {
  if (!ctx.from) return;
  const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return ctx.reply('Usage: /verifywallet <address> <signature>');
  }
  const [address, signature] = parts;
  try {
    const telegramUserId = ctx.from.id;
    const resp = await axios.post(`${API_BASE_URL}/wallet/verify`, { telegramUserId, address, signature });
    if (resp.data.success) {
      await ctx.reply(`✅ Wallet verified and linked: ${resp.data.address}`);
    } else {
      await ctx.reply('Verification failed.');
    }
  } catch (e: any) {
    console.error('verifywallet error', e?.response?.data || e);
    const msg = e?.response?.data?.error;
    switch (msg) {
      case 'invalid_signature':
        await ctx.reply('Signature invalid. Ensure you signed the exact message.');
        break;
      case 'address_mismatch':
        await ctx.reply('Recovered address does not match provided address.');
        break;
      case 'no_active_challenge':
        await ctx.reply('No active challenge. Run /connectwallet first.');
        break;
      default:
        await ctx.reply('Wallet verification failed.');
    }
  }
});

// /walletstatus -> check status
bot.command('walletstatus', async (ctx: any) => {
  if (!ctx.from) return;
  try {
    const telegramUserId = ctx.from.id;
    const resp = await axios.get(`${API_BASE_URL}/wallet/status/${telegramUserId}`);
    if (!resp.data.connected) {
      await ctx.reply('No wallet linked. Use /connectwallet to link one.');
    } else {
      await ctx.reply(`🔗 Wallet connected: ${resp.data.address}`);
    }
  } catch (e) {
    console.error('walletstatus error', e);
    await ctx.reply('Could not fetch wallet status.');
  }
});

// -------------- END WALLET FLOW --------------

// /signal <jsonPayload> (temporary simple version) e.g. /signal {"symbol":"BTCUSDT","side":"BUY"}
bot.command('signal', async (ctx: any) => {
  if (!ctx.from) return;
  const raw = ctx.match?.trim();
  if (!raw) return ctx.reply('Usage: /signal {"symbol":"BTCUSDT","side":"BUY" ...}');
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return ctx.reply('Invalid JSON.'); }
  try {
    const traderId = ctx.from.id; // assume sender is trader; backend ensures trader row exists
    const resp = await axios.post(`${API_BASE_URL}/signal`, { traderId, payload });
    if (resp.status === 201) {
      const d = resp.data;
      const summary = `📡 Signal #${d.signalId}\nFollowers: ${d.followerCount}\nDelivered: ${d.delivered || 0}\nFailed: ${d.failed || 0}`;
      await ctx.reply(summary);
    } else {
      await ctx.reply('Signal accepted.');
    }
  } catch (e: any) {
    console.error('signal command error', e?.response?.data || e);
    await ctx.reply('Failed to broadcast signal.');
  }
});

// /signals [traderId?]
bot.command('signals', async (ctx: any) => {
  const arg = ctx.match?.trim();
  const params = arg ? `?traderId=${encodeURIComponent(arg)}` : '';
  try {
    const resp = await axios.get(`${API_BASE_URL}/signals${params}`);
    const list: any[] = resp.data.signals || [];
    if (!list.length) return ctx.reply('No recent signals.');
    const lines = list.slice(0, 5).map(s => {
      const p = s.payload || {}; return `${s.id} • ${s.trader_id} • ${p.symbol || '?'} • ${p.side || ''} • ${new Date(s.created_at).toLocaleTimeString()}`;
    });
    await ctx.reply(lines.join('\n'));
  } catch (e) {
    console.error('signals list error', e);
    await ctx.reply('Could not fetch signals.');
  }
});

// /onchain [traderId?] -> show next seq & divergence
bot.command('onchain', async (ctx: any) => {
  if (!ctx.from) return;
  const arg = ctx.match?.trim();
  const traderId = arg ? Number(arg) : ctx.from.id;
  if (!traderId || Number.isNaN(traderId)) return ctx.reply('Usage: /onchain [traderId]');
  try {
    const resp = await axios.get(`${API_BASE_URL}/trader/${traderId}/onchain/status`);
    const d = resp.data;
    const diverge = d.diverged ? '⚠️ mismatch' : '✅ synced';
    await ctx.reply(`On-Chain Status for ${traderId}\nNext Seq: ${d.chainNext}\nChain Last: ${d.chainLast}\nDB Last: ${d.dbLast}\n${diverge}`);
  } catch (e: any) {
    const code = e?.response?.data?.error?.code;
    if (code === 'NOT_ONCHAIN') return ctx.reply('Trader not on-chain enabled.');
    console.error('onchain status error', e?.response?.data || e);
    await ctx.reply('Failed to fetch on-chain status');
  }
});

// /verifyanchor <signalId>
bot.command('verifyanchor', async (ctx) => {
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  if (parts.length < 2) {
    return ctx.reply('Usage: /verifyanchor <signalId>');
  }
  const signalId = Number(parts[1]);
  if (Number.isNaN(signalId)) return ctx.reply('Invalid signal id');
  try {
    const base = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
    const r = await fetch(`${base}/api/anchor/${signalId}/verify`);
    const j = await r.json();
    if (!r.ok) {
      return ctx.reply(`Verify error: ${j.error?.code || r.status}`);
    }
    if (j.data?.verified) {
      return ctx.reply(`✅ Anchor verified on-chain for signal ${signalId}`);
    } else {
      return ctx.reply(`❌ Not verified (${j.data?.reason || 'no match'})`);
    }
  } catch (e: any) {
    return ctx.reply('Internal error verifying anchor');
  }
});

// /executions [limit]
bot.command('executions', async (ctx: any) => {
  const arg = ctx.match?.trim();
  const limit = arg && !Number.isNaN(Number(arg)) ? Math.min(Number(arg), 10) : 5;
  try {
    const resp = await axios.get(`${API_BASE_URL}/executed-trades/recent?limit=${limit}`);
    const list: any[] = resp.data.executed || [];
    if (!list.length) return ctx.reply('No recent executions.');
    const lines = list.map(r => {
      const v = r.onchain_verified ? '✅' : (r.error === 'PLAN_HASH_MISMATCH' ? '⚠️' : '⏳');
      return `${r.id} • ${r.status} • slip:${r.slippage_bps ?? '-'} • ${v}`;
    });
    await ctx.reply(lines.join('\n'));
  } catch (e) {
    console.error('executions cmd error', e);
    await ctx.reply('Failed to fetch executions.');
  }
});

// /execution <id>
bot.command('execution', async (ctx: any) => {
  const idRaw = ctx.match?.trim();
  if (!idRaw) return ctx.reply('Usage: /execution <id>');
  const id = Number(idRaw);
  if (Number.isNaN(id)) return ctx.reply('Invalid id');
  try {
    const resp = await axios.get(`${API_BASE_URL}/executed-trade/${id}`);
    const r = resp.data.executed;
    const v = r.onchain_verified ? '✅ verified' : (r.error === 'PLAN_HASH_MISMATCH' ? '⚠️ plan hash mismatch' : '⏳ pending');
    await ctx.reply(`Exec #${r.id}\nStatus: ${r.status}\nTx: ${r.tx_hash || '-'}\nSlippage bps: ${r.slippage_bps ?? '-'}\nFollowers: ${r.follower_count ?? '-'}\nPlan Hash: ${r.plan_hash?.slice(0,10) || '-'}\nIntent Hash: ${r.intent_hash?.slice(0,10) || '-'}\nOn-chain: ${v}`);
  } catch (e) {
    console.error('execution cmd error', e);
    await ctx.reply('Failed to fetch execution.');
  }
});

// /verifyexec <id>
bot.command('verifyexec', async (ctx: any) => {
  const idRaw = ctx.match?.trim();
  if (!idRaw) return ctx.reply('Usage: /verifyexec <executionId>');
  const id = Number(idRaw);
  if (Number.isNaN(id)) return ctx.reply('Invalid id');
  try {
    await axios.get(`${API_BASE_URL}/executed-trade/${id}/verify`);
    await ctx.reply('Verification cycle queued. Re-run /execution ' + id + ' shortly.');
  } catch (e) {
    console.error('verifyexec error', e);
    await ctx.reply('Failed to queue verification.');
  }
});

// /signalfull <signalId>
bot.command('signalfull', async (ctx: any) => {
  const idRaw = ctx.match?.trim();
  if (!idRaw) return ctx.reply('Usage: /signalfull <signalId>');
  const id = Number(idRaw);
  if (Number.isNaN(id)) return ctx.reply('Invalid id');
  try {
    const resp = await axios.get(`${API_BASE_URL}/signal/${id}/full`);
    const d = resp.data;
    const sig = d.signal; const intent = d.intent; const exec = d.execution; const anchor = d.anchor;
    const lines = [] as string[];
    lines.push(`Signal #${id} trader:${sig.trader_id}`);
    if (intent) lines.push(`Intent: ${intent.action} ${intent.market} size=${intent.size_value}`);
    if (anchor) lines.push(`Anchor: ${anchor.status} seq=${anchor.seq ?? '-'} ver=${anchor.verification_status ?? '-'}`);
    if (exec) lines.push(`Exec: ${exec.status} slip=${exec.slippage_bps ?? '-'} onchain=${exec.onchain_verified ? 'yes' : 'no'}`);
    await ctx.reply(lines.join('\n'));
  } catch (e) {
    console.error('signalfull error', e);
    await ctx.reply('Failed to fetch full signal.');
  }
});

// /anchors [limit]
bot.command('anchors', async (ctx: any) => {
  const arg = ctx.match?.trim();
  const limit = arg && !Number.isNaN(Number(arg)) ? Math.min(Number(arg), 10) : 5;
  try {
    const resp = await axios.get(`${API_BASE_URL}/anchors/recent?limit=${limit}`);
    const anchors: any[] = resp.data.anchors || [];
    if (!anchors.length) return ctx.reply('No recent anchors.');
    const lines = anchors.map(a => `${a.signal_id} • ${a.status} • ${a.tx_hash ? a.tx_hash.slice(0,10) : '-'}`);
    await ctx.reply(lines.join('\n'));
  } catch (e) {
    console.error('anchors cmd error', e);
    await ctx.reply('Failed to fetch anchors.');
  }
});

// /metrics - show aggregate
bot.command('metrics', async (ctx: any) => {
  try {
    const resp = await axios.get(`${API_BASE_URL}/metrics`);
    const m = resp.data;
    const ex = m.executedTrades;
    const sl = m.slippage;
    await ctx.reply(`Execs: total=${ex.total} executed=${ex.executed} failed=${ex.failed} pending=${ex.pending}\nVerified=${ex.verified} mismatches=${ex.planHashMismatches}\nSlippage avg=${sl.avg_bps} p90=${sl.p90} n=${sl.count}`);
  } catch (e) {
    console.error('metrics cmd error', e);
    await ctx.reply('Failed to fetch metrics.');
  }
});

// /help - list commands
bot.command('help', async (ctx: any) => {
  const cmds = [
    '/follow <traderId>', '/unfollow <traderId>', '/list', '/settings [..]', '/signal <json>',
    '/signals [traderId]', '/signalfull <id>', '/executions [limit]', '/execution <id>', '/verifyexec <id>',
    '/anchors [limit]', '/onchain [traderId]', '/verifyanchor <signalId>', '/metrics', '/walletstatus', '/connectwallet'
  ];
  await ctx.reply(cmds.join('\n'));
});

bot.start();
console.log("Bot is running and connected to the backend.");
