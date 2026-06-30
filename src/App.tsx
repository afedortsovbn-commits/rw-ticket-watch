import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Search,
  Send,
  Square,
  Train,
} from 'lucide-react'
import type { StationOption, TrainInfo, WatchMode, WatchTask } from '../shared/types'
import './App.css'

type Health = {
  ok: boolean
  telegramConfigured: boolean
  checkIntervalMs: number
  maxChecksPerTask: number
  telegramMinIntervalMs: number
}

type Session = {
  createToken: string
}

type FormState = {
  mode: Extract<WatchMode, 'description' | 'link'>
  from: string
  to: string
  fromExp: string
  fromEsr: string
  toExp: string
  toEsr: string
  trainNumber: string
  date: string
  timeFrom: string
  timeTo: string
  monitorUntil: string
  searchUrl: string
}

type StationField = 'from' | 'to'

const primaryFavorites: StationOption[] = [
  { value: 'Гомель', exp: '2100100', ecp: '150000' },
  { value: 'Минск-Пассажирский', exp: '2100001', ecp: '140210' },
]
// Остальные областные центры — раскрываются по кнопке «Ещё».
const moreFavorites: StationOption[] = [
  { value: 'Брест-Центральный', exp: '2100035', ecp: '130007' },
  { value: 'Витебск', exp: '2100200', ecp: '160000' },
  { value: 'Гродно', exp: '2100070', ecp: '135208' },
  { value: 'Могилев', exp: '2100120', ecp: '155000' },
]

function localDate(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function monitorUntil(date: string, timeTo = '23:59') {
  return `${date}T${timeTo || '23:59'}`
}

function defaultForm(): FormState {
  const date = localDate()
  return {
    mode: 'description',
    from: 'Гомель',
    to: 'Минск-Пассажирский',
    fromExp: '2100100',
    fromEsr: '150000',
    toExp: '2100001',
    toEsr: '140210',
    trainNumber: '',
    date,
    timeFrom: '00:00',
    timeTo: '23:59',
    monitorUntil: monitorUntil(date),
    searchUrl: '',
  }
}

function stationShortName(station: string) {
  return station.replace('-Пассажирский', '').replace('-Центральный', '')
}

function statusText(task: WatchTask) {
  if (task.status === 'active') return 'Мониторинг'
  if (task.status === 'found') return 'Билеты найдены'
  if (task.status === 'completed') return 'Завершено после сигнала'
  if (task.status === 'paused') return 'Пауза'
  if (task.status === 'expired') return 'Завершено'
  return 'Ошибка'
}

function formatDateTime(value?: string) {
  if (!value) return 'еще не было'
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function taskTitle(task: WatchTask) {
  if (task.mode === 'link' && task.searchUrl) {
    return task.trainNumber ? `По ссылке, поезд ${task.trainNumber}` : 'По ссылке pass.rw.by'
  }
  return `${task.from ?? 'Откуда'} -> ${task.to ?? 'Куда'}${task.trainNumber ? `, поезд ${task.trainNumber}` : ''}`
}

function dateFromSearchUrl(url: string) {
  try {
    return new URL(url).searchParams.get('date') ?? undefined
  } catch {
    return undefined
  }
}

function withMonitorDefault(form: FormState) {
  const date = dateFromSearchUrl(form.searchUrl) ?? form.date
  if (!form.monitorUntil) {
    return { ...form, monitorUntil: monitorUntil(date, form.timeTo) }
  }
  return form
}

const TOKEN_KEY = 'rw-auth-token'

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-auth-token': token,
      ...(options.headers as Record<string, string> | undefined),
    },
  })
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    window.location.reload()
    throw new Error('Требуется вход')
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? 'Запрос не выполнен')
  }
  return response.json() as Promise<T>
}

function Login({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(payload?.message ?? 'Не удалось войти')
      }
      const { token } = (await response.json()) as { token: string }
      onSuccess(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-shell login-shell">
      <section className="panel login-panel">
        <h1 className="login-title">Мониторинг свободных мест БЖД</h1>
        <form className="login-form" onSubmit={submit}>
          <h2>Вход</h2>
          <label>
            Логин
            <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <div className="notice">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Вхожу…' : 'Войти'}
          </button>
        </form>
      </section>
    </main>
  )
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  if (!token) {
    return (
      <Login
        onSuccess={(value) => {
          localStorage.setItem(TOKEN_KEY, value)
          setToken(value)
        }}
      />
    )
  }
  return <Dashboard />
}

function Dashboard() {
  const [tasks, setTasks] = useState<WatchTask[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [createToken, setCreateToken] = useState('')
  const [stationOptions, setStationOptions] = useState<Record<StationField, StationOption[]>>({ from: [], to: [] })
  const [stationBusy, setStationBusy] = useState<StationField | null>(null)
  const [previewTrains, setPreviewTrains] = useState<TrainInfo[]>([])
  const [selectedTrains, setSelectedTrains] = useState<string[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [favExpanded, setFavExpanded] = useState<Record<StationField, boolean>>({ from: false, to: false })

  const runningTasks = useMemo(
    () => tasks.filter((task) => task.status === 'active' || task.status === 'paused' || task.status === 'found'),
    [tasks],
  )

  const runningTask = useMemo(
    () => runningTasks[0],
    [runningTasks],
  )

  async function loadData() {
    const [nextTasks, nextHealth, nextSession] = await Promise.all([
      api<WatchTask[]>('/api/tasks'),
      api<Health>('/api/health'),
      api<Session>('/api/session'),
    ])
    setTasks(nextTasks)
    setHealth(nextHealth)
    setCreateToken(nextSession.createToken)
  }

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void loadData(), 0)
    const timer = window.setInterval(() => void loadData(), 5000)
    return () => {
      window.clearTimeout(firstLoad)
      window.clearInterval(timer)
    }
  }, [])

  // При изменении маршрута/даты/времени ранее показанный список поездов устаревает.
  const routeKeys: (keyof FormState)[] = ['from', 'to', 'fromExp', 'toExp', 'date', 'timeFrom', 'timeTo']

  function updateForm(patch: Partial<FormState>) {
    if (routeKeys.some((key) => key in patch)) {
      setPreviewTrains([])
      setSelectedTrains([])
    }
    setForm((current) => {
      const next = { ...current, ...patch }
      const wasAutoMonitor = current.monitorUntil === monitorUntil(current.date, current.timeTo)

      if ((patch.date || patch.timeTo) && wasAutoMonitor) {
        next.monitorUntil = monitorUntil(next.date, next.timeTo)
      }

      if (patch.searchUrl && next.mode === 'link' && wasAutoMonitor) {
        next.monitorUntil = monitorUntil(dateFromSearchUrl(patch.searchUrl) ?? next.date, next.timeTo)
      }

      return next
    })
  }

  function setDate(offsetDays: number) {
    updateForm({ date: localDate(offsetDays) })
  }

  // Меняя название станции вручную или через избранное, сбрасываем выбранный
  // ранее код — иначе проверка пойдёт по старой станции.
  function changeStation(field: StationField, value: string) {
    updateForm(field === 'from' ? { from: value, fromExp: '', fromEsr: '' } : { to: value, toExp: '', toEsr: '' })
    setStationOptions((current) => ({ ...current, [field]: [] }))
  }

  function swapStations() {
    updateForm({
      from: form.to,
      to: form.from,
      fromExp: form.toExp,
      fromEsr: form.toEsr,
      toExp: form.fromExp,
      toEsr: form.fromEsr,
    })
  }

  async function searchStation(field: StationField) {
    const term = (field === 'from' ? form.from : form.to).trim()
    if (term.length < 2) {
      setMessage('Введите хотя бы 2 символа названия станции.')
      return
    }
    setMessage('')
    setStationBusy(field)
    try {
      const options = await api<StationOption[]>(`/api/stations?term=${encodeURIComponent(term)}`)
      setStationOptions((current) => ({ ...current, [field]: options }))
      if (options.length === 0) {
        setMessage(`По запросу «${term}» БЖД не вернул станций. Уточните название.`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось получить список станций')
    } finally {
      setStationBusy(null)
    }
  }

  function pickStation(field: StationField, option: StationOption) {
    updateForm(
      field === 'from'
        ? { from: option.value, fromExp: option.exp, fromEsr: option.ecp ?? '' }
        : { to: option.value, toExp: option.exp, toEsr: option.ecp ?? '' },
    )
    setStationOptions((current) => ({ ...current, [field]: [] }))
  }

  async function showTrains() {
    if (!form.from.trim() || !form.to.trim()) {
      setMessage('Укажите станцию отправления и прибытия.')
      return
    }
    setMessage('')
    setPreviewBusy(true)
    try {
      const trains = await api<TrainInfo[]>('/api/trains/preview', {
        method: 'POST',
        body: JSON.stringify({
          from: form.from,
          to: form.to,
          fromExp: form.fromExp || undefined,
          fromEsr: form.fromEsr || undefined,
          toExp: form.toExp || undefined,
          toEsr: form.toEsr || undefined,
          date: form.date,
          timeFrom: form.timeFrom || undefined,
          timeTo: form.timeTo || undefined,
        }),
      })
      setPreviewTrains(trains)
      setSelectedTrains([])
      if (trains.length === 0) {
        setMessage('На выбранную дату и время поездов не нашлось.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить список поездов')
    } finally {
      setPreviewBusy(false)
    }
  }

  function toggleTrain(number: string) {
    // Поезда с местами выбирать незачем — мониторить нечего.
    const train = previewTrains.find((item) => item.number === number)
    if (train && train.freeSeats > 0) return

    const next = selectedTrains.includes(number)
      ? selectedTrains.filter((item) => item !== number)
      : [...selectedTrains, number]
    setSelectedTrains(next)

    // «Мониторить до» по умолчанию — до отправления последнего выбранного поезда.
    const departures = previewTrains
      .filter((train) => next.includes(train.number))
      .map((train) => train.departure)
      .filter((time) => /^\d{1,2}:\d{2}$/.test(time))
      .sort()
    if (departures.length > 0) {
      setForm((current) => ({ ...current, monitorUntil: `${current.date}T${departures[departures.length - 1]}` }))
    }
  }

  function renderStationField(field: StationField, labelText: string) {
    const value = field === 'from' ? form.from : form.to
    const options = stationOptions[field]
    const loading = stationBusy === field
    return (
      <>
        <label className={`route__field route__field--${field}`}>
          <div className="station-input">
            <span className="cap">{labelText}</span>
            <input value={value} onChange={(event) => changeStation(field, event.target.value)} required />
          </div>
          {options.length > 0 && (
            <ul className="station-options">
              {options.map((option) => (
                <li key={`${field}-${option.exp}`}>
                  <button type="button" onClick={() => pickStation(field, option)}>
                    {option.label ?? option.value}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <button
          type="button"
          className={`secondary compact find-btn find-btn--${field}`}
          onClick={() => void searchStation(field)}
          disabled={loading || value.trim().length < 2}
        >
          <Search size={16} />
          <span className="btn-text">{loading ? 'Ищу…' : 'Найти'}</span>
        </button>
        <span className={`inline-links route__fav route__fav--${field}`}>
          {primaryFavorites.map((option) => (
            <button key={`${field}-${option.exp}`} type="button" onClick={() => pickStation(field, option)}>
              {stationShortName(option.value)}
            </button>
          ))}
          {favExpanded[field] ? (
            moreFavorites.map((option) => (
              <button key={`${field}-${option.exp}`} type="button" onClick={() => pickStation(field, option)}>
                {stationShortName(option.value)}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="more-link"
              onClick={() => setFavExpanded((current) => ({ ...current, [field]: true }))}
            >
              Ещё
            </button>
          )}
        </span>
      </>
    )
  }

  async function createTask() {
    if (busy || runningTask) return
    if (!createToken) {
      setMessage('Форма еще загружается. Подождите пару секунд.')
      return
    }
    if (form.mode === 'description' && selectedTrains.length === 0) {
      setMessage('Нажмите «Показать поезда» и отметьте хотя бы один поезд.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const prepared = withMonitorDefault(form)
      const payload =
        prepared.mode === 'link'
          ? {
              mode: 'link',
              date: dateFromSearchUrl(prepared.searchUrl) ?? prepared.date,
              trainNumber: prepared.trainNumber || undefined,
              timeFrom: prepared.timeFrom || undefined,
              timeTo: prepared.timeTo || undefined,
              monitorUntil: prepared.monitorUntil,
              searchUrl: prepared.searchUrl,
              createToken,
            }
          : {
              mode: 'description',
              from: prepared.from,
              to: prepared.to,
              fromExp: prepared.fromExp || undefined,
              fromEsr: prepared.fromEsr || undefined,
              toExp: prepared.toExp || undefined,
              toEsr: prepared.toEsr || undefined,
              trainNumbers: selectedTrains,
              date: prepared.date,
              timeFrom: prepared.timeFrom || undefined,
              timeTo: prepared.timeTo || undefined,
              monitorUntil: prepared.monitorUntil,
              createToken,
            }

      await api<WatchTask>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setForm((current) => ({ ...defaultForm(), date: current.date }))
      setPreviewTrains([])
      setSelectedTrains([])
      await loadData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось добавить задачу')
    } finally {
      setBusy(false)
    }
  }

  async function stopRunningTasks() {
    setMessage('')
    try {
      await api<{ stopped: number }>('/api/tasks/stop-running', { method: 'POST' })
      await loadData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось остановить мониторинг')
    }
  }

  async function testTelegram() {
    setMessage('')
    try {
      await api('/api/telegram/test', { method: 'POST' })
      setMessage('Тестовое сообщение отправлено в Telegram.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Telegram не ответил')
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <h1>Мониторинг свободных мест БЖД</h1>
        <div className="topbar__status">
          <span>{health?.telegramConfigured ? 'Telegram подключен' : 'Telegram не настроен'}</span>
          <button
            className="secondary compact"
            type="button"
            onClick={() => void testTelegram()}
            title="Отправить тестовое сообщение в Telegram"
          >
            <Send size={16} />
            Тест Telegram
          </button>
        </div>
      </section>

      {(previewBusy || stationBusy) && (
        <div className="overlay">
          <div className="overlay__card">
            <span className="spinner spinner--lg" aria-hidden="true" />
            <p>
              Запрашиваю данные у pass.rw.by
              <span className="overlay__hint">это занимает несколько секунд…</span>
            </p>
          </div>
        </div>
      )}

      <section className="panel main-panel">
        {message && <div className="notice">{message}</div>}

        {runningTask ? (
          <section className="task-view">
            <div className="panel__title split">
              <div>
                <div className="title-row">
                  <Train size={20} />
                  <h2>Текущая задача</h2>
                </div>
                <p>
                  Проверяю наличие мест автоматически каждые несколько минут. Как только места появятся, пришлю
                  сообщение в Telegram и остановлю задачу.
                </p>
              </div>
            </div>

            <article className={`task-card ${runningTask.status}`}>
              <div className="task-card__main">
                <span className="badge">{statusText(runningTask)}</span>
                <h3>{taskTitle(runningTask)}</h3>
                <p>
                  {runningTask.date}
                  {runningTask.timeFrom || runningTask.timeTo
                    ? `, ${runningTask.timeFrom || '00:00'}-${runningTask.timeTo || '23:59'}`
                    : ''}
                </p>
              </div>

              <div className="meta-grid">
                <span>
                  <Clock3 size={16} />
                  {formatDateTime(runningTask.lastCheckedAt)}
                </span>
                <span>
                  Проверок: {runningTask.checkCount ?? 0}
                  {health?.maxChecksPerTask ? ` из ${health.maxChecksPerTask}` : ''}
                </span>
                <span>
                  <CalendarClock size={16} />
                  до {formatDateTime(runningTask.monitorUntil)}
                </span>
                {runningTask.lastResult?.hasTickets && (
                  <span className="success">
                    <CheckCircle2 size={16} />
                    места найдены
                  </span>
                )}
              </div>

              <p className="result">
                {runningTask.error ?? runningTask.lastResult?.message ?? 'Ожидаю первую проверку.'}
              </p>

              <div className="actions">
                <button className="danger" type="button" onClick={() => void stopRunningTasks()}>
                  <Square size={16} />
                  Остановить
                </button>
              </div>
            </article>
          </section>
        ) : (
          <section className="form-panel">
            {/* Переключатель «Тип поиска» временно скрыт — используется режим «по описанию».
                Режим «по ссылке» остаётся в коде, при необходимости вернём селектор. */}
            {form.mode === 'link' ? (
              <section className="form-section">
                <p className="hint">
                  Откройте{' '}
                  <a href="https://pass.rw.by/ru/" target="_blank" rel="noreferrer">
                    сайт БЖД <ExternalLink size={14} />
                  </a>
                  , выберите маршрут и дату, затем вставьте ссылку страницы с перечнем поездов. Обычно в ней уже есть
                  маршрут и дата.
                </p>

                <label>
                  Ссылка поиска
                  <input
                    value={form.searchUrl}
                    onChange={(event) => updateForm({ searchUrl: event.target.value })}
                    placeholder="https://pass.rw.by/ru/route/?from=..."
                    required
                  />
                </label>

                <div className="grid schedule">
                  <label>
                    Номер поезда
                    <input
                      value={form.trainNumber}
                      onChange={(event) => updateForm({ trainNumber: event.target.value })}
                      placeholder="Необязательно"
                    />
                  </label>
                  <label>
                    Время от
                    <input
                      type="time"
                      value={form.timeFrom}
                      onChange={(event) => updateForm({ timeFrom: event.target.value })}
                    />
                  </label>
                  <label>
                    Время до
                    <input type="time" value={form.timeTo} onChange={(event) => updateForm({ timeTo: event.target.value })} />
                  </label>
                </div>

                <label>
                  Мониторить до
                  <input
                    type="datetime-local"
                    value={form.monitorUntil}
                    onChange={(event) => updateForm({ monitorUntil: event.target.value })}
                    required
                  />
                </label>
              </section>
            ) : (
              <section className="form-section">
                <div className="route">
                  {renderStationField('from', 'Откуда')}
                  <button className="swap-button" type="button" onClick={swapStations} aria-label="Поменять местами">
                    <ArrowLeftRight size={16} />
                  </button>
                  {renderStationField('to', 'Куда')}
                </div>

                <div className="schedule">
                  <label className="field-inline">
                    <span className="cap">Дата</span>
                    <input type="date" value={form.date} onChange={(event) => updateForm({ date: event.target.value })} required />
                  </label>
                  <label className="field-inline">
                    <span className="cap">с</span>
                    <input className="time-input" type="time" value={form.timeFrom} onChange={(event) => updateForm({ timeFrom: event.target.value })} />
                  </label>
                  <label className="field-inline">
                    <span className="cap">по</span>
                    <input className="time-input" type="time" value={form.timeTo} onChange={(event) => updateForm({ timeTo: event.target.value })} />
                  </label>
                  <span className="inline-links date-links">
                    <button type="button" onClick={() => setDate(0)}>
                      сегодня
                    </button>
                    <button type="button" onClick={() => setDate(1)}>
                      завтра
                    </button>
                    <button type="button" onClick={() => setDate(2)}>
                      послезавтра
                    </button>
                  </span>
                </div>

                <button className="secondary" type="button" onClick={() => void showTrains()} disabled={previewBusy}>
                  <Search size={16} />
                  {previewBusy ? 'Загружаю поезда…' : 'Показать поезда'}
                </button>

                {previewTrains.length > 0 && (
                  <div className="train-list">
                    {previewTrains.map((train) => {
                      const available = train.freeSeats > 0
                      const checked = selectedTrains.includes(train.number)
                      return (
                        <label
                          key={`${train.number}-${train.departure}`}
                          className={`train-row ${available ? 'available' : 'soldout'} ${checked ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={available}
                            onChange={() => toggleTrain(train.number)}
                          />
                          <span className="train-row__num">{train.number}</span>
                          <span className="train-row__time">
                            {train.departure} → {train.arrival}
                          </span>
                          <span className="train-row__seats">
                            {available ? `${train.freeSeats} мест` : 'нет мест'}
                          </span>
                          {train.places && <span className="train-row__detail">{train.places}</span>}
                        </label>
                      )
                    })}
                  </div>
                )}

                {selectedTrains.length > 0 && (
                  <label>
                    Мониторить до
                    <input
                      type="datetime-local"
                      value={form.monitorUntil}
                      onChange={(event) => updateForm({ monitorUntil: event.target.value })}
                      required
                    />
                  </label>
                )}
              </section>
            )}

            <button
              className="primary"
              type="button"
              disabled={busy || (form.mode === 'description' && selectedTrains.length === 0)}
              onClick={() => void createTask()}
            >
              <Bell size={18} />
              {form.mode === 'description'
                ? `Мониторить${selectedTrains.length ? ` (${selectedTrains.length})` : ''}`
                : 'Запустить мониторинг'}
            </button>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
