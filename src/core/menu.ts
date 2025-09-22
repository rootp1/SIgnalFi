
import { Keyboard } from 'grammy';

// Create a Persistent Menu
export const mainMenu = new Keyboard()
  .text('🚀 Follow a Trader')
  .text('⚙️ My Settings')
  .row()
  .text('📊 My Positions')
  .text('❓ Help')
  .row()
  .resized()
  .persistent();
