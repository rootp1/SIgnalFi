// backend/telegram.ts
// Lightweight Telegram send function for backend fan-out.
// Tries to send a message; returns true if Telegram accepted, false otherwise.

export async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    // No token available; treat as skipped delivery.
    return false;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!resp.ok) {
      // Could log the response text (omitted to reduce noise & avoid leaking data)
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function formatSignalMessage(traderId: number, payload: any): string {
  const lines: string[] = [];
  lines.push(`📡 Signal from ${traderId}`);
  if (payload.symbol) lines.push(`Symbol: ${payload.symbol}`);
  if (payload.side) lines.push(`Side: ${payload.side}`);
  if (payload.entry) lines.push(`Entry: ${payload.entry}`);
  if (payload.targets && Array.isArray(payload.targets)) lines.push(`Targets: ${payload.targets.join(', ')}`);
  if (payload.stop) lines.push(`Stop: ${payload.stop}`);
  if (payload.confidence !== undefined) lines.push(`Confidence: ${payload.confidence}%`);
  if (payload.note) lines.push(`Note: ${payload.note}`);
  return lines.join('\n');
}
