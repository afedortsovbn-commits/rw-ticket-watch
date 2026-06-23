import { join } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'

const userDataDir = join(process.cwd(), 'data', 'browser-profile')

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const launchArgs = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
]

let contextPromise: Promise<BrowserContext> | undefined
// Простая очередь: одновременно выполняется только одна навигация по pass.rw.by.
// Это бережнее к сайту и исключает гонки при решении JS-проверки.
let queue: Promise<unknown> = Promise.resolve()

async function createContext(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: launchArgs,
    userAgent,
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
    viewport: { width: 1366, height: 768 },
  })

  // Маскируем признак автоматизации: JS-проверка БЖД отказывается выдавать
  // cookie доступа, если navigator.webdriver === true.
  // Также определяем __name: esbuild (tsx) добавляет ссылку на этот хелпер
  // в сериализуемые для page.evaluate функции, а в странице его нет.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    const g = globalThis as unknown as { __name?: (fn: unknown) => unknown }
    if (!g.__name) {
      g.__name = (fn: unknown) => fn
    }
  })

  context.on('close', () => {
    contextPromise = undefined
  })

  return context
}

async function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = createContext().catch((error) => {
      contextPromise = undefined
      throw error
    })
  }
  return contextPromise
}

function looksBlocked(title: string, body: string) {
  return (
    title.includes('Access denied') ||
    body.includes('Запрос заблокирован') ||
    body.includes('Доступ к ресурсу ограничен')
  )
}

/**
 * Открывает страницу pass.rw.by, дожидается прохождения JS-проверки
 * (страница "Verification" сама перезагружается) и передаёт готовую
 * страницу в callback. Навигации сериализуются через очередь.
 */
export async function withPassPage<T>(url: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const context = await getContext()
    let page: Page | undefined
    try {
      page = await context.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })

      // Страница проверки доступа крутит спиннер и сама делает location.reload()
      // после установки cookie hg-security. Ждём, пока заголовок перестанет
      // быть "Verification".
      await page
        .waitForFunction(() => !document.title.includes('Verification'), { timeout: 30000 })
        .catch(() => undefined)

      const title = await page.title()
      const body = await page.evaluate(() => document.body?.innerText ?? '')

      if (looksBlocked(title, body)) {
        throw new Error(
          'pass.rw.by заблокировал запрос (WAF). Подождите немного — мониторинг продолжит попытки с увеличенным интервалом.',
        )
      }
      if (title.includes('Verification')) {
        throw new Error('pass.rw.by не пропустил проверку доступа. Мониторинг продолжит попытки.')
      }

      return await fn(page)
    } finally {
      await page?.close().catch(() => undefined)
    }
  }

  // Ставим задачу в конец очереди и не даём ошибке оборвать саму цепочку.
  const result = queue.then(run, run)
  queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export async function closeBrowser() {
  if (!contextPromise) return
  try {
    const context = await contextPromise
    await context.close()
  } catch {
    // игнорируем — закрываемся
  } finally {
    contextPromise = undefined
  }
}
