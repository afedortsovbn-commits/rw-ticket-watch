import { createHash, randomBytes } from 'node:crypto'
import 'dotenv/config'

const authLogin = process.env.AUTH_LOGIN ?? 'Fedortsov'
// Пароль задаётся только через переменные окружения (.env локально, секреты на
// сервере) и НЕ хранится в коде — репозиторий публичный.
const authPassword = process.env.AUTH_PASSWORD ?? ''

export const config = {
  port: Number(process.env.PORT ?? 4174),
  authLogin,
  authPassword,
  // Стабильный токен сессии (производный от логина/пароля), возвращается после
  // входа и проверяется на каждом запросе. Если пароль не задан — токен
  // случайный, то есть войти нельзя и API закрыт, пока не настроят AUTH_PASSWORD.
  authToken: authPassword
    ? createHash('sha256').update(`${authLogin}:${authPassword}`).digest('hex').slice(0, 32)
    : randomBytes(16).toString('hex'),
  // Интервал между проверками. По умолчанию 3 минуты — этого достаточно, чтобы
  // не нагружать сайт и не провоцировать блокировку.
  checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS ?? 180000),
  // Случайная добавка к интервалу (джиттер), чтобы запросы не были ритмичными.
  checkJitterMs: Number(process.env.CHECK_JITTER_MS ?? 45000),
  // 0 = без ограничения: мониторим, пока не появятся места или не истечёт срок.
  maxChecksPerTask: Number(process.env.MAX_CHECKS_PER_TASK ?? 0),
  telegramMinIntervalMs: Number(process.env.TELEGRAM_MIN_INTERVAL_MS ?? 60000),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
}
