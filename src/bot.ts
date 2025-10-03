// src/bot.ts
import { Bot, Keyboard } from "grammy";
import * as dotenv from "dotenv";
import axios from 'axios';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in the .env file!");
}

const API_BASE_URL = 'http://localhost:3000/api';

const bot = new Bot(token);

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

// Refactored command to call the backend
bot.command("follow", async (ctx: any) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const traderId = ctx.match;

  if (!traderId) {
      return ctx.reply("Please specify a trader ID.");
  }

  try {
      await axios.post(`${API_BASE_URL}/follow`, {
          userId: userId,
          traderToFollow: traderId
      });
      await ctx.reply(`✅ Follow request sent for ${traderId}.`);
  } catch (error) {
      console.error("API call to /follow failed:", error);
      await ctx.reply("Sorry, something went wrong.");
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

// TODO: Add other refactored commands here...

bot.start();
console.log("Bot is running and connected to the backend.");
