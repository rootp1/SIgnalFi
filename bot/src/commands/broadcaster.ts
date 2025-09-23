
import { Bot, Context } from 'grammy';
import axios from 'axios';

// Replace with your actual Telegram ID for testing
const BROADCASTER_IDS = [7300924119]; 

// Mock token prices for validation
const mockPrices: { [key: string]: number } = {
  'APT': 8.50,
  'SUI': 1.25,
  'BTC': 65000,
};

export const registerBroadcasterCommands = (bot: Bot<Context>) => {
  const backendUrl = process.env.BACKEND_URL;
  
  if (!backendUrl) {
    console.error('BACKEND_URL environment variable is not set');
    throw new Error('BACKEND_URL environment variable is required');
  }

  /**
   * /signal [buy|sell] [amount] [token]
   * Allows broadcasters to send trading signals.
   */
  bot.command('signal', async (ctx) => {
    console.log('signal command triggered');
    const userId = ctx.from?.id;
    if (!userId || !BROADCASTER_IDS.includes(userId)) {
      await ctx.reply('You are not authorized to use this command.');
      return;
    }

    const match = ctx.match.split(' ');
    if (match.length < 3) {
      await ctx.reply('Usage: /signal [buy|sell] [amount] [token]');
      return;
    }

    const [action, amountStr, token] = match;
    const amount = parseFloat(amountStr);

    if ((action !== 'buy' && action !== 'sell') || isNaN(amount) || !mockPrices[token]) {
      await ctx.reply('Invalid signal format. Usage: /signal [buy|sell] [amount] [token]');
      return;
    }

    try {
      console.log(`Sending signal: ${action} ${amount} ${token} from broadcaster ${userId}`);
      const response = await axios.post(`${backendUrl}/signal`, { 
        broadcasterId: userId,
        action, 
        amount, 
        token 
      });

      const { data } = response.data as any;
      
      if (data.followerCount === 0) {
        await ctx.reply('No one is following you.');
        return;
      }

      await ctx.reply(`🚀 Signal Sent! Executing ${action.toUpperCase()} ${amount} ${token} for ${data.followerCount} followers.`);

      // Send notifications to all followers
      for (const follower of data.followers) {
        const price = mockPrices[token];
        const quantity = follower.trade_amount / price;

        const message = `✅ Trade Executed | Following Trader${userId}\n` +
                        `- ${action === 'buy' ? 'Bought' : 'Sold'}: ${quantity.toFixed(2)} ${token}\n` +
                        `- Price: $${price.toFixed(2)}\n` +
                        `- Cost: ${follower.trade_amount} USDC`;
        
        try {
          await bot.api.sendMessage(follower.telegram_id, message);
        } catch (error) {
          console.error(`Failed to send message to ${follower.telegram_id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error sending signal:', error);
      await ctx.reply('Failed to send signal. Please try again.');
    }
  });
};
