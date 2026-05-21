import 'dotenv/config'

export const config = {
  port: Number(process.env.PORT ?? 4174),
  checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS ?? 3000),
  telegramMinIntervalMs: Number(process.env.TELEGRAM_MIN_INTERVAL_MS ?? 60000),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
}
