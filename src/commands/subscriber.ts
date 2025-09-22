
import { Bot, Context } from 'grammy';
import { userDatabase, mockPrices } from '../core/db';
import { mainMenu } from '../core/menu';

export const registerSubscriberCommands = (bot: Bot<Context>) => {
  /**
   * /start command
   * Welcomes the user and displays the main menu.
   */
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId && !userDatabase.has(userId)) {
      // Initialize user data if it's their first time
      userDatabase.set(userId, { following: [], tradeAmount: 0, openPositions: [] });
    }

    await ctx.reply(
      'Welcome to SignalFi! Connect your wallet and set your trade amount to get started.',
      {
        reply_markup: mainMenu,
      }
    );
  });

  /**
   * /help command
   * Lists available commands.
   */
  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Available commands:\n' +
        '/follow <trader_id> - Follow a new trader.\n' +
        '/unfollow <trader_id> - Unfollow a trader.\n' +
        '/set_trade_amount <amount> - Set your per-trade amount.\n' +
        '/my_settings - View your current settings.\n' +
        '/positions - View your open positions.'
    );
  });

  /**
   * /follow <trader_id> command
   * Adds a trader to the user's following list.
   */
  bot.command('follow', async (ctx) => {
    const userId = ctx.from?.id;
    const traderId = ctx.match;

    if (!userId) {
      return;
    }

    if (!traderId) {
      await ctx.reply('Please provide a trader ID. Usage: /follow TraderX');
      return;
    }

    const userData = userDatabase.get(userId) || { following: [], tradeAmount: 0, openPositions: [] };
    if (!userData.following.includes(traderId)) {
      userData.following.push(traderId);
      userDatabase.set(userId, userData);
    }

    await ctx.reply(`✅ You are now following ${traderId}.`);
  });

  /**
   * /unfollow <trader_id> command
   * Removes a trader from the user's following list.
   */
  bot.command('unfollow', async (ctx) => {
    const userId = ctx.from?.id;
    const traderId = ctx.match;

    if (!userId) {
      return;
    }

    if (!traderId) {
      await ctx.reply('Please provide a trader ID. Usage: /unfollow TraderX');
      return;
    }

    const userData = userDatabase.get(userId);
    if (userData && userData.following.includes(traderId)) {
      userData.following = userData.following.filter((id) => id !== traderId);
      userDatabase.set(userId, userData);
      await ctx.reply(`ℹ️ You have unfollowed ${traderId}.`);
    } else {
      await ctx.reply(`You are not following ${traderId}.`);
    }
  });

  /**
   * /set_trade_amount <amount> command
   * Sets the user's per-trade amount.
   */
  bot.command('set_trade_amount', async (ctx) => {
    const userId = ctx.from?.id;
    const amountStr = ctx.match;

    if (!userId) {
      return;
    }

    if (!amountStr) {
      await ctx.reply('Please provide an amount. Usage: /set_trade_amount 50');
      return;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('Please provide a valid positive number. Usage: /set_trade_amount 50');
      return;
    }

    const userData = userDatabase.get(userId) || { following: [], tradeAmount: 0, openPositions: [] };
    userData.tradeAmount = amount;
    userDatabase.set(userId, userData);

    await ctx.reply(`✅ Your per-trade amount is now set to ${amount}.`);
  });

  /**
   * /my_settings command
   * Displays the user's current settings.
   */
  bot.command('my_settings', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const userData = userDatabase.get(userId);
    if (userData) {
      await ctx.reply(
        `--- Your Settings ---\n` +
        `- Following: ${userData.following.join(', ') || 'None'}\n` +
        `- Per-Trade Amount: ${userData.tradeAmount} USDC`
      );
    } else {
      await ctx.reply("You don't have any settings yet. Use /start to begin.");
    }
  });

  /**
   * /positions command
   * Displays the user's open positions.
   */
  bot.command('positions', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const userData = userDatabase.get(userId);
    if (userData && userData.openPositions.length > 0) {
      let message = '--- Your Open Positions ---\n';
      userData.openPositions.forEach((pos, index) => {
        const currentValue = pos.quantity * (mockPrices[pos.token] || pos.entryPrice);
        const entryValue = pos.quantity * pos.entryPrice;
        const pnl = currentValue - entryValue;
        const pnlSign = pnl >= 0 ? '+' : '-';
        message += `${index + 1}. ${pos.token}: ${pos.quantity.toFixed(2)} units | Entry: $${pos.entryPrice.toFixed(2)} | PnL: ${pnlSign}$${Math.abs(pnl).toFixed(2)}\n`;
      });
      await ctx.reply(message);
    } else {
      await ctx.reply('You have no open positions.');
    }
  });

    // Handle bot text messages for menu buttons
    bot.on('message:text', async (ctx) => {
        const text = ctx.message.text;
        switch (text) {
            case '🚀 Follow a Trader':
                await ctx.reply("To follow a trader, use the /follow command followed by the trader's ID. For example: `/follow TraderX`");
                break;
            case '⚙️ My Settings':
                await ctx.reply("To check your settings, use the /my_settings command.");
                break;
            case '📊 My Positions':
                await ctx.reply("To check your positions, use the /positions command.");
                break;
            case '❓ Help':
                await ctx.reply(
                    'Available commands:\n' +
                    '/follow <trader_id> - Follow a new trader.\n' +
                    '/unfollow <trader_id> - Unfollow a trader.\n' +
                    '/set_trade_amount <amount> - Set your per-trade amount.\n' +
                    '/my_settings - View your current settings.\n' +
                    '/positions - View your open positions.'
                );
                break;
        }
    });
};
