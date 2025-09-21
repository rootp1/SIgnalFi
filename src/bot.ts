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
  .url("Connect Wallet", "https://placeholder.com")
  .resized();

bot.command("start", async (ctx) => {
  await ctx.reply("Welcome to SignalFi! Your settings are now saved permanently.", {
    reply_markup: mainMenu,
  });
});

// Refactored command to call the backend
bot.command("follow", async (ctx) => {
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

// Add other refactored commands here...

bot.start();
console.log("Bot is running and connected to the backend.");
