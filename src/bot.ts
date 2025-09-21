// src/bot.ts
import { Bot, Keyboard } from "grammy";
import * as dotenv from "dotenv";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in the .env file!");
}

// --- NEW IN SPRINT 2: Enhanced Mock Database ---
interface Position {
  token: string;
  amount: number; // The amount of the token bought
  entryPrice: number;
}

interface UserSettings {
  following: string[];
  tradeAmount: number;
  token: string;
  positions: Position[]; // Array to store mock positions
}

const userSettingsDB = new Map<number, UserSettings>();

// --- BOT SETUP ---
const bot = new Bot(token);

// --- REUSABLE MENU ---
const mainMenu = new Keyboard()
  .text("Follow a Trader")
  .text("My Settings")
  .row() // Creates a new row
  .text("/positions") // --- NEW IN SPRINT 2 ---
  .text("Connect Wallet (Coming Soon)") // Placeholder for URL button
  .resized();

// --- BOT COMMANDS ---
bot.command("start", async (ctx) => {
  const userId = ctx.from?.id;
  if (userId && !userSettingsDB.has(userId)) {
    userSettingsDB.set(userId, {
      following: [],
      tradeAmount: 0,
      token: 'USDC',
      positions: [], // Initialize positions array for new users
    });
  }
  await ctx.reply(
    "Welcome to SignalFi! 🚀\n\nSprint 2 Update: You can now simulate trades! Try following yourself (use your own Telegram username) and send a /signal.",
    { reply_markup: mainMenu }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "--- **Available Commands** ---\n\n" +
    "/start - Launch the bot.\n" +
    "/menu - Show the main menu.\n" +
    "/follow <username> - Copy a trader.\n" +
    "/unfollow <username> - Stop copying.\n" +
    "/set_trade_amount <amount> <token> - Set your trade amount.\n" +
    "/my_settings - View your configuration.\n" +
    "--- **Broadcaster Commands** ---\n" +
    "/signal <buy|sell> <amount> <token> - Send a trade signal (e.g., /signal buy 10 APT).\n" +
    "/positions - View your open mock positions.\n" +
    "/close <token> - Close a mock position (e.g. /close APT)."
  );
});

bot.command("menu", async (ctx) => {
  await ctx.reply("Here is the main menu:", { reply_markup: mainMenu });
});

// --- SUBSCRIBER COMMANDS ---
bot.command("follow", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const traderId = ctx.match;

  if (!traderId) {
      return ctx.reply("Please specify a trader ID to follow. \nExample: /follow @YourUsername");
  }

  const settings = userSettingsDB.get(userId) || { following: [], tradeAmount: 0, token: 'USDC', positions: [] };
  if (!settings.following.includes(traderId)) {
      settings.following.push(traderId);
      userSettingsDB.set(userId, settings);
      await ctx.reply(`✅ You are now following ${traderId}.`);
  } else {
      await ctx.reply(`You are already following ${traderId}.`);
  }
});

bot.command("unfollow", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const traderId = ctx.match;

  if (!traderId) {
      return ctx.reply("Please specify a trader ID to unfollow. \nExample: /unfollow @YourUsername");
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
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const args = ctx.match.split(" ");
  const amount = parseFloat(args[0] || '');
  const token = args[1]?.toUpperCase() || 'USDC';

  if (isNaN(amount) || amount <= 0) {
      return ctx.reply("Please provide a valid number for the amount. \nExample: /set_trade_amount 50 USDC");
  }

  const settings = userSettingsDB.get(userId) || { following: [], tradeAmount: 0, token: 'USDC', positions: [] };
  settings.tradeAmount = amount;
  settings.token = token;
  userSettingsDB.set(userId, settings);

  await ctx.reply(`✅ Your trade amount has been set to ${amount} ${token} per trade.`);
});

bot.command("my_settings", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const settings = userSettingsDB.get(userId);

  if (!settings) {
      return ctx.reply("I don't have any settings for you yet. Press /start to begin.");
  }

  const followingList = settings.following.length > 0 ? settings.following.join(', ') : 'None';

  await ctx.reply(
      `--- **Your Settings** ---\n\n` +
      `- **Following**: ${followingList}\n` +
      `- **Per-Trade Amount**: ${settings.tradeAmount} ${settings.token}\n` +
      `- **Open Positions**: ${settings.positions.length}`
  );
});

// --- NEW IN SPRINT 2: BROADCASTER AND POSITION COMMANDS ---

bot.command("signal", async (ctx) => {
  if (!ctx.from?.username) {
    return ctx.reply("Cannot broadcast signal: your Telegram username is not set.");
  }
  const broadcasterUsername = ctx.from.username;

  // e.g. "buy 10 APT"
  const args = ctx.match.split(" ");
  if (args.length < 3 || !args[0] || !args[1] || !args[2]) {
    return ctx.reply("Invalid signal format. \nExample: /signal buy 10 APT");
  }
  const side = args[0].toLowerCase();
  const amount = parseFloat(args[1]);
  const token = args[2].toUpperCase();

  if (isNaN(amount)) {
    return ctx.reply("Invalid amount in signal. \nExample: /signal buy 10 APT");
  }

  // For simulation, we'll just make up a price
  const mockEntryPrice = Math.random() * 10 + 5; // Random price between 5 and 15

  await ctx.reply(`🚀 Signal Received! Broadcasting BUY ${amount} ${token} to your followers...`);

  // Loop through all users in our DB
  for (const [userId, settings] of userSettingsDB.entries()) {
    // Check if the user is following the person who sent the signal
    if (settings.following.includes(broadcasterUsername)) {
      if (settings.tradeAmount <= 0) {
        // Send a notification that the trade failed
        await bot.api.sendMessage(userId, `❌ Trade Failed | Signal from ${broadcasterUsername}\n- Reason: Your trade amount is not set. Use /set_trade_amount.`);
        continue; // Skip to the next user
      }

      const tokenAmountToBuy = settings.tradeAmount / mockEntryPrice;

      const newPosition: Position = {
        token: token,
        amount: tokenAmountToBuy,
        entryPrice: mockEntryPrice
      };
      
      settings.positions.push(newPosition);
      userSettingsDB.set(userId, settings);

      // Send a push notification to the follower
      await bot.api.sendMessage(userId, 
        `✅ **Trade Executed** | Following ${broadcasterUsername}\n` +
        `- **Bought**: ${tokenAmountToBuy.toFixed(2)} ${token}\n` +
        `- **Price**: $${mockEntryPrice.toFixed(2)}\n` +
        `- **Cost**: ${settings.tradeAmount} ${settings.token}`
      );
    }
  }
});

bot.command("positions", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const settings = userSettingsDB.get(userId);

  if (!settings || settings.positions.length === 0) {
    return ctx.reply("You have no open positions.");
  }

  let response = "--- **Your Open Positions** ---\n\n";
  settings.positions.forEach((pos, index) => {
    // Let's simulate a current price for PnL calculation
    const mockCurrentPrice = pos.entryPrice * (Math.random() * 0.2 + 0.9); // Fluctuates +/- 10%
    const initialValue = pos.amount * pos.entryPrice;
    const currentValue = pos.amount * mockCurrentPrice;
    const pnl = currentValue - initialValue;
    const pnlSign = pnl >= 0 ? "+" : "";

    response += `${index + 1}. **${pos.token}**\n` +
                `   - Amount: ${pos.amount.toFixed(2)}\n` +
                `   - Entry Price: $${pos.entryPrice.toFixed(2)}\n` +
                `   - Current Price: $${mockCurrentPrice.toFixed(2)}\n` +
                `   - PnL: ${pnlSign}$${pnl.toFixed(2)}\n\n`;
  });

  await ctx.reply(response);
});

bot.command("close", async (ctx) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  const tokenToClose = ctx.match.toUpperCase();

  if (!tokenToClose) {
      return ctx.reply("Please specify which token to close. \nExample: /close APT");
  }

  const settings = userSettingsDB.get(userId);
  const positionIndex = settings?.positions.findIndex(p => p.token === tokenToClose);

  if (settings && positionIndex !== undefined && positionIndex > -1) {
      // const position = settings.positions[positionIndex];
      
      // Remove the position from the array
      settings.positions.splice(positionIndex, 1);
      userSettingsDB.set(userId, settings);

      await ctx.reply(`✅ Position for ${tokenToClose} has been closed.`);
  } else {
      await ctx.reply(`You do not have an open position for ${tokenToClose}.`);
  }
});

// --- START THE BOT ---
bot.start();
console.log("Bot is running with Sprint 2 features!");
