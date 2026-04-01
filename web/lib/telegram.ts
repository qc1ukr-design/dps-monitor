/**
 * Telegram notification helper.
 * Requires TELEGRAM_BOT_TOKEN env var to be set in Vercel.
 */

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`)
  }
}
