
import { Bot, Keyboard } from 'grammy';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// 1. Setup and Initialization
// ---------------------------

// Get bot token from environment variable
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set in the environment variables.');
  process.exit(1);
}

// Initialize a new bot instance
const bot = new Bot(token);

// Define the structure for user data
interface UserData {
  following: string[];
  tradeAmount: number;
}

// Create an in-memory Map to act as a mock database
const userDatabase = new Map<number, UserData>();

// 2. Create a Persistent Menu
// ---------------------------

const mainMenu = new Keyboard()
  .text('🚀 Follow a Trader')
  .text('⚙️ My Settings')
  .text('❓ Help')
  .row()
  .resized()
  .persistent();

// 3. Implement Core Commands
// --------------------------

/**
 * /start command
 * Welcomes the user and displays the main menu.
 */
bot.command('start', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId && !userDatabase.has(userId)) {
    // Initialize user data if it's their first time
    userDatabase.set(userId, { following: [], tradeAmount: 0 });
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
      '/set_trade_amount <amount> - Set your per-trade amount.'
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
    return; // Should not happen in a command context
  }

  if (!traderId) {
    await ctx.reply('Please provide a trader ID. Usage: /follow TraderX');
    return;
  }

  const userData = userDatabase.get(userId) || { following: [], tradeAmount: 0 };
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

  const userData = userDatabase.get(userId) || { following: [], tradeAmount: 0 };
  userData.tradeAmount = amount;
  userDatabase.set(userId, userData);

  await ctx.reply(`✅ Your per-trade amount is now set to ${amount}.`);
});

// 4. Start the Bot
// ----------------

bot.start();
console.log('Bot is running...');

// Handle bot text messages for menu buttons
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    switch (text) {
        case '🚀 Follow a Trader':
            await ctx.reply("To follow a trader, use the /follow command followed by the trader's ID. For example: `/follow TraderX`");
            break;
        case '⚙️ My Settings':
            const userId = ctx.from?.id;
            if (userId) {
                const userData = userDatabase.get(userId);
                if (userData) {
                    await ctx.reply(`Your current settings:\n- Following: ${userData.following.join(', ') || 'None'}\n- Trade Amount: ${userData.tradeAmount}`);
                } else {
                    await ctx.reply("You don't have any settings yet. Use /start to begin.");
                }
            }
            break;
        case '❓ Help':
            await ctx.reply(
                'Available commands:\n' +
                '/follow <trader_id> - Follow a new trader.\n' +
                '/unfollow <trader_id> - Unfollow a trader.\n' +
                '/set_trade_amount <amount> - Set your per-trade amount.'
            );
            break;
    }
});
