import { config } from './config.js'

export function isTelegramConfigured() {
  return Boolean(config.telegramBotToken && config.telegramChatId)
}

export async function sendTelegramMessage(text: string) {
  if (!isTelegramConfigured()) {
    return { ok: false, description: 'Telegram не настроен' }
  }

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  )

  const payload = (await response.json()) as { ok: boolean; description?: string }
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? 'Telegram вернул ошибку')
  }
  return payload
}
