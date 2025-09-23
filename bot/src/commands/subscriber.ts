
import { Bot, Context } from 'grammy';
import axios from 'axios';
import { mainMenu } from '../core/menu';

const showHelp = async (ctx: Context) => {
  console.log('help command triggered');
  await ctx.reply(
    'Available commands:\n' +
    '/follow <trader_id> - Follow a new trader.\n' +
    '/unfollow <trader_id> - Unfollow a trader.\n' +
    '/set_trade_amount <amount> - Set your per-trade amount.\n' +
    '/my_settings - View your current settings.\n' +
    '/positions - View your open positions.'
  );
};

const showSettings = async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (userId) {
    try {
      const backendUrl = process.env.BACKEND_URL;
      const response = await axios.get(`${backendUrl}/users/${userId}/details`);
      const data = response.data as { settings: { trade_amount: number }, following: number[] };
      await ctx.reply(
        `--- Your Settings ---\n` +
        `- Following: ${data.following.join(', ') || 'None'}\n` +
        `- Per-Trade Amount: ${data.settings.trade_amount} USDC`
      );
    } catch (error) {
      console.error('Error fetching settings:', error);
      await ctx.reply('Could not fetch your settings. Please try again.');
    }
  }
};

const showPositions = async (ctx: Context) => {
  const userId = ctx.from?.id;
  if (userId) {
    try {
      const backendUrl = process.env.BACKEND_URL;
      const response = await axios.get(`${backendUrl}/positions/${userId}`);
      const positions = response.data as any[];

      if (positions.length === 0) {
        await ctx.reply('You have no open positions.');
        return;
      }

      let message = '--- Your Open Positions ---\n';
      positions.forEach(p => {
        message += `\n[${p.action.toUpperCase()}] ${p.quantity.toFixed(2)} ${p.token} at $${p.entry_price.toFixed(2)}`;
      });

      await ctx.reply(message);
    } catch (error) {
      console.error('Error fetching positions:', error);
      await ctx.reply('Could not fetch your positions. Please try again.');
    }
  }
};

export const registerSubscriberCommands = (bot: Bot<Context>) => {
  const backendUrl = process.env.BACKEND_URL;
  
  if (!backendUrl) {
    console.error('BACKEND_URL environment variable is not set');
    throw new Error('BACKEND_URL environment variable is required');
  }

  bot.command('start', async (ctx) => {
    console.log('start command triggered');
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    if (userId) {
      try {
        await axios.post(`${backendUrl}/users`, { telegramId: userId, username });
      } catch (error) {
        console.error('Error creating user:', error);
      }
    }
    await ctx.reply(
      'Welcome to SignalFi! Connect your wallet and set your trade amount to get started.',
      {
        reply_markup: mainMenu,
      }
    );
  });

  bot.command('help', showHelp);
  bot.hears('❓ Help', showHelp);

  bot.command('follow', async (ctx) => {
    console.log('follow command triggered');
    const userId = ctx.from?.id;
    const broadcasterId = parseInt(ctx.match, 10);
    console.log(`userId: ${userId}, broadcasterId: ${broadcasterId}, match: "${ctx.match}"`);
    if (userId && !isNaN(broadcasterId)) {
      try {
        console.log(`Making request to: ${backendUrl}/subscriptions`);
        await axios.post(`${backendUrl}/subscriptions`, { followerId: userId, broadcasterId });
        await ctx.reply(`✅ You are now following trader ${broadcasterId}.`);
      } catch (error) {
        console.error('Error following trader:', error);
        await ctx.reply('Could not follow trader. Please try again.');
      }
    } else {
      await ctx.reply('Please provide a valid trader ID.');
    }
  });
  bot.hears('🚀 Follow a Trader', async (ctx) => {
    await ctx.reply('To follow a trader, use the command: /follow <trader_id>');
  });

  bot.command('unfollow', async (ctx) => {
    const userId = ctx.from?.id;
    const broadcasterId = parseInt(ctx.match, 10);
    if (userId && !isNaN(broadcasterId)) {
      try {
        await axios({
          method: 'delete',
          url: `${backendUrl}/subscriptions`,
          data: { followerId: userId, broadcasterId }
        });
        await ctx.reply(`ℹ️ You have unfollowed trader ${broadcasterId}.`);
      } catch (error) {
        console.error('Error unfollowing trader:', error);
        await ctx.reply('Could not unfollow trader. Please try again.');
      }
    } else {
      await ctx.reply('Please provide a valid trader ID.');
    }
  });

  bot.command('set_trade_amount', async (ctx) => {
    console.log('set_trade_amount command triggered');
    const userId = ctx.from?.id;
    const amount = parseFloat(ctx.match);
    console.log(`userId: ${userId}, amount: ${amount}, match: "${ctx.match}"`);
    if (userId && !isNaN(amount) && amount > 0) {
      try {
        console.log(`Making request to: ${backendUrl}/settings/${userId}`);
        await axios.put(`${backendUrl}/settings/${userId}`, { tradeAmount: amount });
        await ctx.reply(`✅ Your per-trade amount is now set to ${amount}.`);
      } catch (error) {
        console.error('Error setting trade amount:', error);
        await ctx.reply('Could not set trade amount. Please try again.');
      }
    } else {
      await ctx.reply('Please provide a valid positive number.');
    }
  });

  bot.command('my_settings', showSettings);
  bot.hears('⚙️ My Settings', showSettings);
  
  bot.command('positions', showPositions);
  bot.hears('📊 My Positions', showPositions);
};
