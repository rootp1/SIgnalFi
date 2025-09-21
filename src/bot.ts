// src/bot.ts
import { Bot, Keyboard } from "grammy";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Get the token from the environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in the .env file!");
}

// 1. --- MOCK DATABASE ---
// We'll use a simple Map to store user settings in memory.
// The key is the user's Telegram ID (a number).
interface UserSettings {
  following: string[];
  tradeAmount: number;
  token: string;
}
const userSettingsDB = new Map<number, UserSettings>();

// 2. --- BOT SETUP ---
const bot = new Bot(token);

// 3. --- REUSABLE MENU ---
// Create a persistent menu that will appear with the /start and /menu commands
const mainMenu = new Keyboard()
  .text("Follow a Trader").row()
  .text("My Settings").row()
  .text("Connect Wallet (Coming Soon)") // Placeholder text
  .resized(); // Makes the keyboard smaller

// 4. --- BOT COMMANDS ---

// Handle the /start command
bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  if (userId && !userSettingsDB.has(userId)) {
    // Initialize settings for a new user
    userSettingsDB.set(userId, {
        following: [],
        tradeAmount: 0,
        token: 'USDC'
    });
  }

  await ctx.reply(
    "Welcome to SignalFi! 🚀\n\nI can help you copy-trade like a pro, right here on Telegram.\n\nUse the menu below to get started.",
    {
      reply_markup: mainMenu,
    }
  );
});

// Handle the /help command
bot.command("help", async (ctx) => {
    await ctx.reply(
        "--- Available Commands ---\n\n" +
        "/start - Launch the bot and show the main menu.\n" +
        "/menu - Show the main menu again.\n" +
        "/follow <trader_id> - Start copying a trader.\n" +
        "/unfollow <trader_id> - Stop copying a trader.\n" +
        "/set_trade_amount <amount> <token> - Set your amount per trade (e.g., /set_trade_amount 50 USDC).\n" +
        "/my_settings - View your current configuration."
    );
});

// Handle the /menu command
bot.command("menu", async (ctx) => {
    await ctx.reply("Here is the main menu:", {
        reply_markup: mainMenu,
    });
});


// 5. --- SUBSCRIBER COMMANDS ---
// For now, these commands just update our mock database.

bot.command("follow", async (ctx) => {
    const userId = ctx.from.id;
    const traderId = ctx.match; // The text after the command

    if (!traderId) {
        return ctx.reply("Please specify a trader ID to follow. \nExample: /follow TraderX");
    }

    const settings = userSettingsDB.get(userId) || { following: [], tradeAmount: 0, token: 'USDC' };
    if (!settings.following.includes(traderId)) {
        settings.following.push(traderId);
        userSettingsDB.set(userId, settings);
        await ctx.reply(`✅ You are now following ${traderId}.`);
    } else {
        await ctx.reply(`You are already following ${traderId}.`);
    }
});

bot.command("unfollow", async (ctx) => {
    const userId = ctx.from.id;
    const traderId = ctx.match;

    if (!traderId) {
        return ctx.reply("Please specify a trader ID to unfollow. \nExample: /unfollow TraderX");
    }

    const settings = userSettingsDB.get(userId);
    if (settings && settings.following.includes(traderId)) {
        settings.following = settings.following.filter(t => t !== traderId);
        userSettingsDB.set(userId, settings);
        await ctx.reply(`ℹ️ You have stopped following ${traderId}.`);
    } else {
        await ctx.reply(`You are not currently following ${traderId}.`);
    }
});

bot.command("set_trade_amount", async (ctx) => {
    const userId = ctx.from.id;
    // e.g., "50 USDC"
    const args = ctx.match.split(" ");
    const amount = parseFloat(args[0]);
    const token = args[1]?.toUpperCase() || 'USDC';

    if (isNaN(amount) || amount <= 0) {
        return ctx.reply("Please provide a valid number for the amount. \nExample: /set_trade_amount 50 USDC");
    }

    const settings = userSettingsDB.get(userId) || { following: [], tradeAmount: 0, token: 'USDC' };
    settings.tradeAmount = amount;
    settings.token = token;
    userSettingsDB.set(userId, settings);

    await ctx.reply(`✅ Your trade amount has been set to ${amount} ${token} per trade.`);
});

// This command is useful for debugging our mock data
bot.command("my_settings", async (ctx) => {
    const userId = ctx.from.id;
    const settings = userSettingsDB.get(userId);

    if (!settings) {
        return ctx.reply("I don't have any settings for you yet. Press /start to begin.");
    }
    
    const followingList = settings.following.length > 0 ? settings.following.join(', ') : 'None';
    
    await ctx.reply(
        `--- Your Settings ---\n\n` +
        `- Following: ${followingList}\n` +
        `- Per-Trade Amount: ${settings.tradeAmount} ${settings.token}`
    );
});


// 6. --- START THE BOT ---
bot.start();
console.log("Bot is running!");