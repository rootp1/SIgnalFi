
import { Bot, Context } from 'grammy';
import { userDatabase, mockPrices } from '../core/db';

// Replace with your actual Telegram ID for testing
const BROADCASTER_IDS = [7300924119]; 

export const registerBroadcasterCommands = (bot: Bot<Context>) => {
  /**
   * /signal [buy|sell] [amount] [token]
   * Allows broadcasters to send trading signals.
   */
  bot.command('signal', async (ctx) => {
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

    const broadcasterId = `Trader${userId}`; // Using Telegram ID as trader name
    const followers: number[] = [];

    // Find all users following this broadcaster
    userDatabase.forEach((userData, followerId) => {
      if (userData.following.includes(broadcasterId)) {
        followers.push(followerId);
      }
    });

    if (followers.length === 0) {
      await ctx.reply('No one is following you.');
      return;
    }

    await ctx.reply(`🚀 Signal Sent! Executing ${action.toUpperCase()} ${amount} ${token} for ${followers.length} followers.`);

    // Simulate trade execution for each follower
    for (const followerId of followers) {
      const followerData = userDatabase.get(followerId);
      if (followerData && followerData.tradeAmount > 0) {
        const price = mockPrices[token];
        const quantity = followerData.tradeAmount / price;

        // Add the new position to the follower's data
        followerData.openPositions.push({
          token,
          quantity,
          entryPrice: price,
        });
        userDatabase.set(followerId, followerData);

        // Send notification to the follower
        const message = `✅ Trade Executed | Following ${broadcasterId}\n` +
                        `- Bought: ${quantity.toFixed(2)} ${token}\n` +
                        `- Price: $${price.toFixed(2)}\n` +
                        `- Cost: ${followerData.tradeAmount} USDC`;
        
        try {
          await bot.api.sendMessage(followerId, message);
        } catch (error) {
          console.error(`Failed to send message to ${followerId}:`, error);
        }
      }
    }
  });
};
