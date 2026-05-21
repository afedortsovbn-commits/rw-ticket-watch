import type { CheckResult, WatchTask } from '../shared/types.js'

const ticketSignals = ['Выбрать места', 'Свободные места', 'Свободно мест', 'Купить билет']
const soldOutSignals = ['Мест нет', 'Нет мест', 'Продажа закрыта', 'свободных мест нет']

function normalize(value = '') {
  return value.trim().replace(/\s+/g, ' ')
}

function buildSearchUrl(task: WatchTask) {
  if (task.searchUrl?.trim()) {
    return task.searchUrl.trim()
  }

  const params = new URLSearchParams()
  if (task.from) params.set('from', task.from)
  if (task.to) params.set('to', task.to)
  if (task.date) params.set('date', task.date)
  if (task.trainNumber) params.set('train', task.trainNumber)

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
  const sourceUrl = buildSearchUrl(task)
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`pass.rw.by вернул HTTP ${response.status}`)
  }

  const html = await response.text()
  const text = normalize(stripTags(html))
  const matches = ticketSignals.filter((signal) => text.includes(signal))
  const soldOutMatches = soldOutSignals.filter((signal) => text.includes(signal))
  const trainMatches =
    task.trainNumber && !text.includes(task.trainNumber) ? [] : task.trainNumber ? [task.trainNumber] : []
  const hasTickets = matches.length > 0 && containsTimeWindow(text, task)

  return {
    hasTickets,
    sourceUrl,
    checkedAt: new Date().toISOString(),
    matches: [...matches, ...trainMatches],
    message: hasTickets
      ? 'Похоже, появились доступные места.'
      : soldOutMatches.length > 0
        ? 'Мест пока нет.'
        : 'Я проверил страницу, но явного сигнала наличия мест не нашел.',
  }
}
