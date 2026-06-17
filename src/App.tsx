import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Train,
} from 'lucide-react'
import type { WatchTask } from '../shared/types'
import './App.css'

type Health = {
  ok: boolean
  telegramConfigured: boolean
  checkIntervalMs: number
  telegramMinIntervalMs: number
}

const emptyForm = {
  mode: 'route',
  from: 'Минск-Пассажирский',
  to: 'Брест-Центральный',
  trainNumber: '',
  date: new Date().toISOString().slice(0, 10),
  timeFrom: '',
  timeTo: '',
  monitorUntil: '',
  searchUrl: '',
  comment: '',
}

function statusText(task: WatchTask) {
  if (task.status === 'active') return 'Мониторинг'
  if (task.status === 'found') return 'Есть сигнал'
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
  const [form, setForm] = useState(emptyForm)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const activeCount = useMemo(
    () => tasks.filter((task) => task.status === 'active' || task.status === 'found').length,
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

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        ...form,
        mode: 'route',
        from: form.from,
        to: form.to,
        trainNumber: form.trainNumber || undefined,
      }
      await api<WatchTask>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setForm((current) => ({ ...emptyForm, date: current.date }))
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
          <span>{activeCount} активных</span>
          <span>{health?.telegramConfigured ? 'Telegram подключен' : 'Telegram не настроен'}</span>
        </div>
      </section>

      <section className="workspace">
        <form className="panel form-panel" onSubmit={createTask}>
          <div className="panel__title">
            <Search size={20} />
            <h2>Новая проверка</h2>
          </div>

          <div className="grid two">
            <label>
              Откуда
              <input
                value={form.from}
                onChange={(event) => setForm({ ...form, from: event.target.value })}
                required
              />
            </label>
            <label>
              Куда
              <input
                value={form.to}
                onChange={(event) => setForm({ ...form, to: event.target.value })}
                required
              />
            </label>
          </div>

          <label>
            Номер поезда
            <input
              value={form.trainNumber}
              onChange={(event) => setForm({ ...form, trainNumber: event.target.value })}
              placeholder="Необязательно, например 701Б"
            />
          </label>

          <div className="grid three">
            <label>
              Дата
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
                required
              />
            </label>
            <label>
              Время от
              <input
                type="time"
                value={form.timeFrom}
                onChange={(event) => setForm({ ...form, timeFrom: event.target.value })}
              />
            </label>
            <label>
              Время до
              <input
                type="time"
                value={form.timeTo}
                onChange={(event) => setForm({ ...form, timeTo: event.target.value })}
              />
            </label>
          </div>

          <label>
            Мониторить до
            <input
              type="datetime-local"
              value={form.monitorUntil}
              onChange={(event) => setForm({ ...form, monitorUntil: event.target.value })}
              required
            />
          </label>

          <label>
            Точная ссылка поиска
            <input
              value={form.searchUrl}
              onChange={(event) => setForm({ ...form, searchUrl: event.target.value })}
              placeholder="Можно оставить пустым"
            />
          </label>

          <label>
            Заметка
            <input
              value={form.comment}
              onChange={(event) => setForm({ ...form, comment: event.target.value })}
              placeholder="Например, нижняя полка или один билет"
            />
          </label>

          <button className="primary" type="submit" disabled={busy}>
            <Bell size={18} />
            Запустить мониторинг
          </button>
        </form>

        <section className="panel tasks-panel">
          <div className="panel__title split">
            <div>
              <div className="title-row">
                <Train size={20} />
                <h2>Активные задачи</h2>
              </div>
              <p>Проверка выполняется раз в 3 секунды.</p>
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

          <div className="task-list">
            {tasks.length === 0 ? (
              <div className="empty">Задач пока нет. Добавьте маршрут или поезд слева.</div>
            ) : (
              tasks.map((task) => (
                <article className={`task-card ${task.status}`} key={task.id}>
                  <div className="task-card__main">
                    <span className="badge">{statusText(task)}</span>
                    <h3>
                      {task.from} {'->'} {task.to}
                      {task.trainNumber ? `, поезд ${task.trainNumber}` : ''}
                    </h3>
                    <p>
                      {task.date}
                      {task.timeFrom || task.timeTo ? `, ${task.timeFrom || '00:00'}-${task.timeTo || '23:59'}` : ''}
                    </p>
                  </div>

                  <div className="meta-grid">
                    <span>
                      <Clock3 size={16} />
                      {formatDateTime(task.lastCheckedAt)}
                    </span>
                    <span>
                      <CalendarClock size={16} />
                      до {formatDateTime(task.monitorUntil)}
                    </span>
                    {task.lastResult?.hasTickets && (
                      <span className="success">
                        <CheckCircle2 size={16} />
                        места найдены
                      </span>
                    )}
                  </div>

                  <p className="result">{task.error ?? task.lastResult?.message ?? 'Ожидаю первую проверку.'}</p>

                  <div className="actions">
                    <button type="button" onClick={() => void checkNow(task)}>
                      <RefreshCw size={16} />
                      Проверить
                    </button>
                    {task.status === 'paused' ? (
                      <button type="button" onClick={() => void setStatus(task, 'active')}>
                        <Play size={16} />
                        Продолжить
                      </button>
                    ) : (
                      <button type="button" onClick={() => void setStatus(task, 'paused')}>
                        <Pause size={16} />
                        Пауза
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
