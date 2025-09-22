
import { Bot } from 'grammy';
import dotenv from 'dotenv';
import { registerSubscriberCommands } from './commands/subscriber';
import { registerBroadcasterCommands } from './commands/broadcaster';

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

// Register all commands
registerSubscriberCommands(bot);
registerBroadcasterCommands(bot);


// 4. Start the Bot
// ----------------

bot.start();
console.log('Bot is running...');

