import type { CheckResult, StationOption, TrainInfo, WatchTask } from '../shared/types.js'
import { withPassPage } from './browser.js'

type StationSuggestion = {
  value: string
  exp: string
  ecp?: string
  label?: string
}

// Часто используемые станции — чтобы не дёргать автокомплит лишний раз.
const knownStations: Record<string, StationSuggestion> = {
  'минск': { value: 'Минск-Пассажирский', exp: '2100001', ecp: '140210' },
  'минск-пассажирский': { value: 'Минск-Пассажирский', exp: '2100001', ecp: '140210' },
  'брест': { value: 'Брест-Центральный', exp: '2100035', ecp: '130007' },
  'брест-центральный': { value: 'Брест-Центральный', exp: '2100035', ecp: '130007' },
  'гомель': { value: 'Гомель', exp: '2100100', ecp: '150000' },
  'гомель-пассажирский': { value: 'Гомель', exp: '2100100', ecp: '150000' },
  'гродно': { value: 'Гродно', exp: '2100070', ecp: '135200' },
  'витебск': { value: 'Витебск', exp: '2100200', ecp: '160000' },
  'могилёв': { value: 'Могилев', exp: '2100120', ecp: '155000' },
  'могилев': { value: 'Могилев', exp: '2100120', ecp: '155000' },
}

function stationKey(value: string) {
  return value.trim().toLowerCase()
}

// Запрос к справочнику станций БЖД. Автокомплит требует пройденной JS-проверки,
// поэтому делаем запрос из контекста уже открытой страницы pass.rw.by.
async function fetchAutocomplete(query: string): Promise<StationSuggestion[]> {
  const url = `https://pass.rw.by/ru/ajax/autocomplete/search/?term=${encodeURIComponent(query)}`
  // Тело evaluate передаём строкой: так esbuild (tsx) не подмешивает в него
  // хелпер __name, которого нет в контексте страницы.
  const script = String.raw`(async () => {
    const response = await fetch(${JSON.stringify(url)}, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    })
    return response.text()
  })()`
  const raw = (await withPassPage('https://pass.rw.by/ru/', (page) =>
    page.evaluate(script),
  )) as string

  try {
    return JSON.parse(raw) as StationSuggestion[]
  } catch {
    throw new Error(`Не удалось разобрать справочник станций для "${query}". Попробуйте режим по ссылке.`)
  }
}

// Поиск вариантов станций для выбора пользователем в панели.
export async function searchStations(query: string): Promise<StationOption[]> {
  const term = query.trim()
  if (!term) {
    return []
  }

  const known = knownStations[stationKey(term)]
  const suggestions = await fetchAutocomplete(term)
  const options = suggestions
    .filter((station) => station.value && station.exp)
    .map((station) => ({
      value: station.value,
      exp: station.exp,
      ecp: station.ecp,
      label: station.label ?? station.value,
    }))

  // Если станция есть в локальном словаре, поднимаем её точное совпадение наверх.
  if (known && !options.some((option) => option.exp === known.exp)) {
    options.unshift({ value: known.value, exp: known.exp, ecp: known.ecp, label: known.value })
  }
  return options
}

async function lookupStation(query: string): Promise<StationSuggestion> {
  const known = knownStations[stationKey(query)]
  if (known) {
    return known
  }

  const suggestions = await fetchAutocomplete(query)
  const exact = suggestions.find((station) => station.value?.toLowerCase() === query.toLowerCase())
  const station = exact ?? suggestions[0]
  if (!station?.exp) {
    throw new Error(`Станция "${query}" не найдена на pass.rw.by`)
  }
  return station
}

type RouteSource = {
  searchUrl?: string
  from?: string
  to?: string
  fromExp?: string
  fromEsr?: string
  toExp?: string
  toEsr?: string
  date: string
}

type TimeWindow = { timeFrom?: string; timeTo?: string }

async function buildSearchUrl(task: RouteSource): Promise<string> {
  if (task.searchUrl?.trim()) {
    return task.searchUrl.trim()
  }

  if (!task.from || !task.to) {
    throw new Error('Для проверки мест нужен маршрут: станция отправления и станция прибытия.')
  }

  // Если коды станций уже выбраны в панели — используем их и не дёргаем
  // автокомплит на каждой проверке.
  const fromStation: StationSuggestion =
    task.fromExp ? { value: task.from, exp: task.fromExp, ecp: task.fromEsr } : await lookupStation(task.from)
  const toStation: StationSuggestion =
    task.toExp ? { value: task.to, exp: task.toExp, ecp: task.toEsr } : await lookupStation(task.to)

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

// Парсинг списка поездов выполняется внутри страницы браузера: так мы читаем
// итоговый DOM после выполнения скриптов сайта, а не сырой HTML.
async function parseTrains(sourceUrl: string): Promise<TrainInfo[]> {
  return withPassPage(sourceUrl, async (page) => {
    await page
      .waitForSelector('.sch-table__row-wrap.js-row, .sch-no-results, .train-info-empty', { timeout: 15000 })
      .catch(() => undefined)

    // Тело evaluate — строкой, чтобы tsx/esbuild не ломал его хелпером __name.
    const script = String.raw`(() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim()
      const rows = Array.from(document.querySelectorAll('.sch-table__row-wrap.js-row'))
      return rows.map((row) => {
        const places = Array.from(row.querySelectorAll('.sch-table__t-item.has-quant'))
          .map((node) => clean(node.textContent))
          .filter(Boolean)
          .join('; ')
        return {
          number: clean(row.querySelector('.train-number') ? row.querySelector('.train-number').textContent : ''),
          departure: clean(row.querySelector('.train-from-time') ? row.querySelector('.train-from-time').textContent : ''),
          arrival: clean(row.querySelector('.train-to-time') ? row.querySelector('.train-to-time').textContent : ''),
          hasPlaces: row.classList.contains('w_places'),
          places,
        }
      })
    })()`
    const parsed = (await page.evaluate(script)) as Omit<TrainInfo, 'freeSeats'>[]
    return parsed.map((train) => ({ ...train, freeSeats: sumSeats(train.places) }))
  })
}

// В каждой записи вида "Плацкартный 39 28,92 BYN" первое число — количество мест.
function sumSeats(places: string): number {
  return places.split(';').reduce((sum, part) => {
    const match = part.match(/\d+/)
    return sum + (match ? Number(match[0]) : 0)
  }, 0)
}

function normalizeTrainNumber(value: string) {
  return value.replace(/\s+/g, '').toUpperCase()
}

function wantedTrainNumbers(task: WatchTask) {
  if (task.trainNumbers?.length) return task.trainNumbers
  if (task.trainNumber) return [task.trainNumber]
  return []
}

function matchesTrainFilter(train: TrainInfo, task: WatchTask) {
  const wanted = wantedTrainNumbers(task)
  if (wanted.length === 0) return true
  return wanted.some((number) => normalizeTrainNumber(train.number).includes(normalizeTrainNumber(number)))
}

function matchesTimeWindow(train: TrainInfo, window: TimeWindow) {
  const time = train.departure
  if (!/^\d{1,2}:\d{2}$/.test(time)) return true
  if (window.timeFrom && time < window.timeFrom) return false
  if (window.timeTo && time > window.timeTo) return false
  return true
}

function describeTrain(train: TrainInfo) {
  const places = train.places ? `, ${train.places}` : ''
  return `${train.number} ${train.departure}-${train.arrival}${places}`
}

// Текущие дата и время в часовом поясе Минска (БЖД показывает местное время).
function minskNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function isFutureDeparture(date: string, departure: string, now = minskNowParts()) {
  if (!/^\d{1,2}:\d{2}$/.test(departure)) return true // время не распознали — не отсекаем
  if (date > now.date) return true
  if (date < now.date) return false
  return departure > now.time
}

// Список поездов для выбора в панели: рейсы маршрута в заданном окне времени,
// у которых отправление ещё не прошло.
export async function previewTrains(input: RouteSource & TimeWindow): Promise<TrainInfo[]> {
  const sourceUrl = await buildSearchUrl(input)
  const trains = await parseTrains(sourceUrl)
  const now = minskNowParts()
  return trains.filter(
    (train) => matchesTimeWindow(train, input) && isFutureDeparture(input.date, train.departure, now),
  )
}

export async function checkTickets(task: WatchTask): Promise<CheckResult> {
  const sourceUrl = await buildSearchUrl(task)
  const allTrains = await parseTrains(sourceUrl)
  const checkedAt = new Date().toISOString()

  const matched = allTrains.filter((train) => matchesTrainFilter(train, task) && matchesTimeWindow(train, task))
  const withPlaces = matched.filter((train) => train.hasPlaces)
  const hasTickets = withPlaces.length > 0

  let message: string
  if (hasTickets) {
    message = `Есть места: ${withPlaces.map(describeTrain).join(' | ')}`
  } else if (allTrains.length === 0) {
    message = 'На странице маршрута не нашлось ни одного поезда на эту дату.'
  } else if (matched.length === 0) {
    const wanted = wantedTrainNumbers(task)
    message = wanted.length
      ? `Поезд${wanted.length > 1 ? 'а' : ''} ${wanted.join(', ')} не найден${wanted.length > 1 ? 'ы' : ''} среди ${allTrains.length} рейсов на эту дату/время.`
      : 'Поездов под заданное время отправления не нашлось.'
  } else {
    message = `Мест пока нет (проверено рейсов: ${matched.length}).`
  }

  return {
    hasTickets,
    sourceUrl,
    checkedAt,
    matches: withPlaces.map((train) => train.number),
    trains: matched,
    message,
  }
}
