import { useEffect, useMemo, useState } from 'react'
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
import type { WatchMode, WatchTask } from '../shared/types'
import './App.css'

type Health = {
  ok: boolean
  telegramConfigured: boolean
  checkIntervalMs: number
  telegramMinIntervalMs: number
}

type Session = {
  createToken: string
}

type FormState = {
  mode: Extract<WatchMode, 'description' | 'link'>
  from: string
  to: string
  trainNumber: string
  date: string
  timeFrom: string
  timeTo: string
  monitorUntil: string
  searchUrl: string
}

const stationFavorites = ['Минск-Пассажирский', 'Брест-Центральный', 'Гомель']

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
    from: 'Минск-Пассажирский',
    to: 'Брест-Центральный',
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

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? 'Запрос не выполнен')
  }
  return response.json() as Promise<T>
}

function App() {
  const [tasks, setTasks] = useState<WatchTask[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [createToken, setCreateToken] = useState('')

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

  function updateForm(patch: Partial<FormState>) {
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

  function setStation(field: 'from' | 'to', station: string) {
    updateForm({ [field]: station })
  }

  function swapStations() {
    updateForm({ from: form.to, to: form.from })
  }

  async function createTask() {
    if (busy || runningTask) return
    if (!createToken) {
      setMessage('Форма еще загружается. Подождите пару секунд.')
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
              trainNumber: prepared.trainNumber || undefined,
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
        <div>
          <p className="eyebrow">Монитор билетов БЖД</p>
          <h1>Проверка свободных мест</h1>
        </div>
        <div className="topbar__status">
          <span>{runningTasks.length ? `${runningTasks.length} активн.` : 'нет активных задач'}</span>
          <span>{health?.telegramConfigured ? 'Telegram подключен' : 'Telegram не настроен'}</span>
        </div>
      </section>

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
                <p>Проверка идет автоматически раз в 3 секунды. Чтобы выбрать другой маршрут, остановите мониторинг.</p>
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
            <div className="panel__title split">
              <div className="title-row">
                <Search size={20} />
                <h2>Новая проверка</h2>
              </div>
              <button className="secondary compact" type="button" onClick={() => void testTelegram()}>
                <Send size={16} />
                Проверить Telegram
              </button>
            </div>

            <fieldset className="mode-choice">
              <legend>Как задать поиск</legend>
              <label className={form.mode === 'description' ? 'selected' : ''}>
                <input
                  type="radio"
                  checked={form.mode === 'description'}
                  onChange={() => updateForm({ mode: 'description' })}
                />
                По описанию
              </label>
              <label className={form.mode === 'link' ? 'selected' : ''}>
                <input type="radio" checked={form.mode === 'link'} onChange={() => updateForm({ mode: 'link' })} />
                По ссылке
              </label>
            </fieldset>

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
                <div className="route-grid">
                  <label>
                    Откуда
                    <input value={form.from} onChange={(event) => updateForm({ from: event.target.value })} required />
                    <span className="inline-links">
                      {stationFavorites.map((station) => (
                        <button key={`from-${station}`} type="button" onClick={() => setStation('from', station)}>
                          {stationShortName(station)}
                        </button>
                      ))}
                    </span>
                  </label>
                  <button className="swap-button" type="button" onClick={swapStations} aria-label="Поменять местами">
                    <ArrowLeftRight size={18} />
                  </button>
                  <label>
                    Куда
                    <input value={form.to} onChange={(event) => updateForm({ to: event.target.value })} required />
                    <span className="inline-links">
                      {stationFavorites.map((station) => (
                        <button key={`to-${station}`} type="button" onClick={() => setStation('to', station)}>
                          {stationShortName(station)}
                        </button>
                      ))}
                    </span>
                  </label>
                </div>

                <label>
                  Номер поезда
                  <input
                    value={form.trainNumber}
                    onChange={(event) => updateForm({ trainNumber: event.target.value })}
                    placeholder="Необязательно, например 701Б"
                  />
                </label>

                <div className="grid schedule">
                  <label>
                    Дата
                    <input type="date" value={form.date} onChange={(event) => updateForm({ date: event.target.value })} required />
                    <span className="inline-links">
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
                  </label>
                  <label>
                    Время от
                    <input type="time" value={form.timeFrom} onChange={(event) => updateForm({ timeFrom: event.target.value })} />
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
            )}

            <button className="primary" type="button" disabled={busy} onClick={() => void createTask()}>
              <Bell size={18} />
              Запустить мониторинг
            </button>
          </section>
        )}
      </section>
    </main>
  )
}

export default App
