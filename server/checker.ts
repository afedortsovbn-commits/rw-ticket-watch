import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckResult, WatchTask } from '../shared/types.js'

const ticketSignals = [
  'Выбрать места',
  'Выбрать место',
  'Свободные места',
  'Свободно мест',
  'Купить билет',
  'Оформить заказ',
]
const soldOutSignals = ['Мест нет', 'Нет мест', 'Продажа закрыта', 'свободных мест нет']
const routePageSignals = ['sch-table', 'Маршрут', 'Время отправления', 'Время прибытия', 'Выбрать места', 'Мест нет']

type StationSuggestion = {
  value: string
  exp: string
  ecp?: string
}

const requestHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

const execFileAsync = promisify(execFile)
const requestTimeoutMs = 7000
const knownStations: Record<string, StationSuggestion> = {
  'минск-пассажирский': { value: 'Минск-Пассажирский', exp: '2100001', ecp: '140210' },
  'брест-центральный': { value: 'Брест-Центральный', exp: '2100035', ecp: '130007' },
  'гомель': { value: 'Гомель', exp: '2100100', ecp: '150000' },
  'гомель-пассажирский': { value: 'Гомель-Пассажирский', exp: '2100100', ecp: '150000' },
}

async function normalizePassSearchUrl(rawUrl: string) {
  const url = new URL(rawUrl)

  if (!url.hostname.endsWith('pass.rw.by') || !url.pathname.includes('/route/')) {
    return rawUrl
  }

  for (const field of ['from', 'to'] as const) {
    const stationName = url.searchParams.get(field)
    const expParam = `${field}_exp`
    const esrParam = `${field}_esr`
    const exp = url.searchParams.get(expParam)

    if (!stationName || (exp && exp !== '0')) {
      continue
    }

    const station = await lookupStation(stationName)
    url.searchParams.set(field, station.value)
    url.searchParams.set(expParam, station.exp)
    if (station.ecp) {
      url.searchParams.set(esrParam, station.ecp)
    }
  }

  return url.toString()
}

function normalize(value = '') {
  return value.trim().replace(/\s+/g, ' ')
}

async function fetchViaPowerShell(url: string, headers: Record<string, string>) {
  const psUrl = url.replace(/'/g, "''")
  const psAccept = (headers.Accept ?? headers.accept ?? '*/*').replace(/'/g, "''")
  const psCookie = (headers.Cookie ?? headers.cookie ?? '').replace(/'/g, "''")
  const script = [
    `$Url = '${psUrl}';`,
    `$Accept = '${psAccept}';`,
    `$Cookie = '${psCookie}';`,
    '$ProgressPreference = "SilentlyContinue";',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;',
    '$headers = @{ "User-Agent" = "Mozilla/5.0"; "Accept" = $Accept; "X-Requested-With" = "XMLHttpRequest" };',
    'if ($Cookie.Length -gt 0) { $headers["Cookie"] = $Cookie };',
    '$response = Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $Url;',
    'Write-Output $response.Content;',
  ].join(' ')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
    maxBuffer: 15 * 1024 * 1024,
    timeout: requestTimeoutMs,
    windowsHide: true,
  })
  return stdout
}

async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 1) {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'неизвестная сетевая ошибка'
  if (process.platform === 'win32') {
    const headers = (init.headers as Record<string, string> | undefined) ?? {}
    try {
      const text = await fetchViaPowerShell(url, headers)
      return new Response(text, { status: 200 })
    } catch {
      throw new Error(
        `pass.rw.by не ответил за ${Math.round(requestTimeoutMs / 1000)} секунд. Это похоже на блокировку или зависание соединения, мониторинг продолжит попытки.`,
      )
    }
  }
  throw new Error(`Не удалось подключиться к pass.rw.by после ${attempts} попыток: ${message}`)
}

function getVerificationCookie(html: string) {
  if (!html.includes('<title>Verification</title>') && !html.includes('hg-security=')) {
    return undefined
  }
  return html.match(/hg-security=([^;"]+)/)?.[1]
}

async function fetchTextWithVerificationRetry(url: string, headers: Record<string, string>) {
  const response = await fetchWithRetry(url, { headers })
  const text = await response.text()
  const cookie = getVerificationCookie(text)

  if (!cookie) {
    return { response, text }
  }

  const retryResponse = await fetchWithRetry(url, {
    headers: {
      ...headers,
      Cookie: `hg-security=${cookie}`,
    },
  })
  const retryText = await retryResponse.text()

  if (getVerificationCookie(retryText)) {
    throw new Error('pass.rw.by вернул страницу проверки доступа вместо данных. Откройте сайт БЖД в браузере или попробуйте позже.')
  }

  return { response: retryResponse, text: retryText }
}

async function lookupStation(query: string): Promise<StationSuggestion> {
  const known = knownStations[query.trim().toLowerCase()]
  if (known) {
    return known
  }

  const { response, text: raw } = await fetchTextWithVerificationRetry(
    `https://pass.rw.by/ru/ajax/autocomplete/search/?term=${encodeURIComponent(query)}`,
    {
      ...requestHeaders,
      Accept: 'application/json,text/javascript,*/*;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
    },
  )

  if (!response.ok) {
    throw new Error(`Не удалось найти станцию "${query}": pass.rw.by вернул HTTP ${response.status}`)
  }

  if (raw.trim().startsWith('<')) {
    throw new Error(`pass.rw.by вернул страницу проверки вместо справочника станции "${query}". Попробуйте точную ссылку поиска или добавьте станцию в словарь.`)
  }

  const suggestions = JSON.parse(raw) as StationSuggestion[]
  const exact = suggestions.find((station) => station.value.toLowerCase() === query.toLowerCase())
  const station = exact ?? suggestions[0]

  if (!station?.exp) {
    throw new Error(`Станция "${query}" не найдена на pass.rw.by`)
  }

  return station
}

async function buildSearchUrl(task: WatchTask) {
  if (task.searchUrl?.trim()) {
    return normalizePassSearchUrl(task.searchUrl.trim())
  }

  if (!task.from || !task.to) {
    throw new Error('Для проверки мест нужен маршрут: станция отправления и станция прибытия.')
  }

  const [fromStation, toStation] = await Promise.all([lookupStation(task.from), lookupStation(task.to)])
  const params = new URLSearchParams()
  params.set('from', fromStation.value)
  params.set('from_exp', fromStation.exp)
  if (fromStation.ecp) params.set('from_esr', fromStation.ecp)
  params.set('to', toStation.value)
  params.set('to_exp', toStation.exp)
  if (toStation.ecp) params.set('to_esr', toStation.ecp)
  params.set('date', task.date)

  return `https://pass.rw.by/ru/route/?${params.toString()}`
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

function assertLooksLikeRoutePage(html: string, text: string) {
  if (routePageSignals.some((signal) => html.includes(signal) || text.includes(signal))) {
    return
  }

  if (html.includes('<title>Verification</title>') || html.includes('hg-security=')) {
    throw new Error('pass.rw.by вернул страницу проверки доступа вместо списка поездов. Мониторинг продолжит попытки.')
  }

  throw new Error(
    'Я получил ответ pass.rw.by, но не распознал в нем страницу со списком поездов. Не буду считать это отсутствием мест.',
  )
}

function containsTimeWindow(text: string, task: WatchTask) {
  if (!task.timeFrom && !task.timeTo) {
    return true
  }
  const times = [...text.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b/g)].map((match) => match[0])
  if (times.length === 0) {
    return true
  }
  return times.some((time) => {
    if (task.timeFrom && time < task.timeFrom) return false
    if (task.timeTo && time > task.timeTo) return false
    return true
  })
}

export async function checkTickets(task: WatchTask): Promise<CheckResult> {
  const sourceUrl = await buildSearchUrl(task)
  const { response, text: html } = await fetchTextWithVerificationRetry(sourceUrl, requestHeaders)

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'pass.rw.by сейчас отклонил автоматическую проверку с HTTP 403. Это похоже на временную защиту сайта, а не на ошибку маршрута. Мониторинг продолжит попытки; если 403 повторяется постоянно, нужен локальный браузерный режим.',
      )
    }
    throw new Error(`pass.rw.by вернул HTTP ${response.status}`)
  }

  const text = normalize(stripTags(html))
  assertLooksLikeRoutePage(html, text)

  const matches = ticketSignals.filter((signal) => text.includes(signal))
  const soldOutMatches = soldOutSignals.filter((signal) => text.includes(signal))
  const trainMatches = task.trainNumber && text.includes(task.trainNumber) ? [task.trainNumber] : []
  const trainMatchesFilter = !task.trainNumber || trainMatches.length > 0
  const hasTickets = matches.length > 0 && trainMatchesFilter && containsTimeWindow(text, task)

  return {
    hasTickets,
    sourceUrl,
    checkedAt: new Date().toISOString(),
    matches: [...matches, ...trainMatches],
    message: hasTickets
      ? 'Похоже, появились доступные места.'
      : task.trainNumber && trainMatches.length === 0
        ? `На странице маршрута не найден поезд ${task.trainNumber}. Проверьте номер поезда или направление.`
      : soldOutMatches.length > 0
        ? 'Мест пока нет.'
        : 'Я проверил страницу, но явного сигнала наличия мест не нашел.',
  }
}
