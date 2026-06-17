import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
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

function defaultForm(): FormState {
  return {
    mode: 'description',
    from: 'Минск-Пассажирский',
    to: 'Брест-Центральный',
    trainNumber: '',
    date: localDate(),
    timeFrom: '',
    timeTo: '',
    monitorUntil: '',
    searchUrl: '',
  }
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
  if (!form.monitorUntil && form.timeTo) {
    return { ...form, monitorUntil: `${date}T${form.timeTo}` }
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

  const runningTask = useMemo(
    () => tasks.find((task) => task.status === 'active' || task.status === 'paused' || task.status === 'found'),
    [tasks],
  )

  async function loadData() {
    const [nextTasks, nextHealth] = await Promise.all([
      api<WatchTask[]>('/api/tasks'),
      api<Health>('/api/health'),
    ])
    setTasks(nextTasks)
    setHealth(nextHealth)
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
      if (patch.timeTo && !current.monitorUntil) {
        const date = dateFromSearchUrl(next.searchUrl) ?? next.date
        next.monitorUntil = `${date}T${patch.timeTo}`
      }
      if (patch.date && current.timeTo && current.monitorUntil === `${current.date}T${current.timeTo}`) {
        next.monitorUntil = `${patch.date}T${current.timeTo}`
      }
      return next
    })
  }

  function setStation(field: 'from' | 'to', station: string) {
    updateForm({ [field]: station })
  }

  function swapStations() {
    updateForm({ from: form.to, to: form.from })
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
            }

      await api<WatchTask>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setForm((current) => ({ ...defaultForm(), date: current.date }))
      setMessage('Задача добавлена. Мониторинг уже запущен.')
      await loadData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось добавить задачу')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(task: WatchTask, status: WatchTask['status']) {
    await api<WatchTask>(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    await loadData()
  }

  async function checkNow(task: WatchTask) {
    setMessage('')
    try {
      await api<WatchTask>(`/api/tasks/${task.id}/check`, { method: 'POST' })
      await loadData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Проверка не удалась')
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
          <h1>Проверка свободных мест без лишнего шума</h1>
        </div>
        <div className="topbar__status">
          <span>{runningTask ? '1 активная задача' : 'нет активных задач'}</span>
          <span>{health?.telegramConfigured ? 'Telegram подключен' : 'Telegram не настроен'}</span>
        </div>
      </section>

      <section className={`workspace ${runningTask ? 'single' : ''}`}>
        {!runningTask && (
          <form className="panel form-panel" onSubmit={createTask}>
            <div className="panel__title">
              <Search size={20} />
              <h2>Новая проверка</h2>
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

                <div className="grid two">
                  <label>
                    Номер поезда
                    <input
                      value={form.trainNumber}
                      onChange={(event) => updateForm({ trainNumber: event.target.value })}
                      placeholder="Необязательно"
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
                  </label>
                  <button className="swap-button" type="button" onClick={swapStations} aria-label="Поменять местами">
                    <ArrowLeftRight size={18} />
                  </button>
                  <label>
                    Куда
                    <input value={form.to} onChange={(event) => updateForm({ to: event.target.value })} required />
                  </label>
                </div>

                <div className="favorites">
                  <span>Быстро:</span>
                  {stationFavorites.map((station) => (
                    <button key={`from-${station}`} type="button" onClick={() => setStation('from', station)}>
                      из {station.replace('-Пассажирский', '').replace('-Центральный', '')}
                    </button>
                  ))}
                  {stationFavorites.map((station) => (
                    <button key={`to-${station}`} type="button" onClick={() => setStation('to', station)}>
                      в {station.replace('-Пассажирский', '').replace('-Центральный', '')}
                    </button>
                  ))}
                </div>

                <label>
                  Номер поезда
                  <input
                    value={form.trainNumber}
                    onChange={(event) => updateForm({ trainNumber: event.target.value })}
                    placeholder="Необязательно, например 701Б"
                  />
                </label>

                <div className="quick-dates">
                  <button type="button" onClick={() => updateForm({ date: localDate(0) })}>
                    Сегодня
                  </button>
                  <button type="button" onClick={() => updateForm({ date: localDate(1) })}>
                    Завтра
                  </button>
                  <button type="button" onClick={() => updateForm({ date: localDate(2) })}>
                    Послезавтра
                  </button>
                </div>

                <div className="grid three">
                  <label>
                    Дата
                    <input type="date" value={form.date} onChange={(event) => updateForm({ date: event.target.value })} required />
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

            <button className="primary" type="submit" disabled={busy}>
              <Bell size={18} />
              Запустить мониторинг
            </button>
          </form>
        )}

        <section className="panel tasks-panel">
          <div className="panel__title split">
            <div>
              <div className="title-row">
                <Train size={20} />
                <h2>{runningTask ? 'Текущая задача' : 'Состояние'}</h2>
              </div>
              <p>Проверка выполняется раз в 3 секунды. При находке придут 3 уведомления подряд.</p>
            </div>
            <button className="icon-button" type="button" onClick={() => void loadData()} aria-label="Обновить">
              <RefreshCw size={18} />
            </button>
          </div>

          {message && <div className="notice">{message}</div>}

          <button className="secondary" type="button" onClick={() => void testTelegram()}>
            <Send size={18} />
            Проверить Telegram
          </button>

          {runningTask ? (
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
                <button type="button" onClick={() => void checkNow(runningTask)}>
                  <RefreshCw size={16} />
                  Проверить
                </button>
                {runningTask.status === 'paused' ? (
                  <button type="button" onClick={() => void setStatus(runningTask, 'active')}>
                    <Play size={16} />
                    Продолжить
                  </button>
                ) : (
                  <button type="button" onClick={() => void setStatus(runningTask, 'paused')}>
                    <Pause size={16} />
                    Пауза
                  </button>
                )}
                <button type="button" onClick={() => void setStatus(runningTask, 'expired')}>
                  <Square size={16} />
                  Остановить
                </button>
              </div>
            </article>
          ) : (
            <div className="empty">
              Активной задачи нет. Выберите поиск слева: по описанию маршрута или по готовой ссылке с сайта БЖД.
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
