import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { WatchTask } from '../shared/types.js'
import { config } from './config.js'
import { previewTrains, searchStations } from './checker.js'
import { runTaskNow, startScheduler } from './scheduler.js'
import { readTasks, updateTask, writeTasks } from './store.js'
import { isTelegramConfigured, sendTelegramMessage } from './telegram.js'

const app = express()

app.use(cors())
app.use(express.json())

const watchSchema = z.object({
  mode: z.enum(['description', 'link', 'route', 'train']),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  fromExp: z.string().trim().optional(),
  fromEsr: z.string().trim().optional(),
  toExp: z.string().trim().optional(),
  toEsr: z.string().trim().optional(),
  trainNumber: z.string().trim().optional(),
  trainNumbers: z.array(z.string().trim()).optional(),
  date: z.string().trim().min(1),
  timeFrom: z.string().trim().optional(),
  timeTo: z.string().trim().optional(),
  monitorUntil: z.string().trim().min(1),
  searchUrl: z.string().trim().url().optional().or(z.literal('')),
  comment: z.string().trim().optional(),
})

const runningStatuses = new Set(['active', 'paused', 'found'])
let isCreatingTask = false
const createTokens = new Set<string>()

app.post('/api/login', (request, response) => {
  const { login, password } = (request.body ?? {}) as { login?: string; password?: string }
  if (!config.authPassword) {
    response.status(503).json({ message: 'Вход не настроен на сервере (не задан AUTH_PASSWORD).' })
    return
  }
  if (login === config.authLogin && password === config.authPassword) {
    response.json({ token: config.authToken })
    return
  }
  response.status(401).json({ message: 'Неверный логин или пароль' })
})

// Простая защита API: все запросы к /api (кроме входа и проверки доступности)
// требуют токен, полученный после входа.
app.use((request, response, next) => {
  if (!request.path.startsWith('/api/')) {
    next()
    return
  }
  if (request.path === '/api/login' || request.path === '/api/health') {
    next()
    return
  }
  if (request.header('x-auth-token') !== config.authToken) {
    response.status(401).json({ message: 'Требуется вход' })
    return
  }
  next()
})

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    telegramConfigured: isTelegramConfigured(),
    checkIntervalMs: config.checkIntervalMs,
    maxChecksPerTask: config.maxChecksPerTask,
    telegramMinIntervalMs: config.telegramMinIntervalMs,
  })
})

app.get('/api/session', (_request, response) => {
  const createToken = crypto.randomUUID()
  createTokens.add(createToken)
  response.json({ createToken })
})

app.get('/api/stations', async (request, response, next) => {
  try {
    const term = z.string().trim().min(2).parse(request.query.term)
    response.json(await searchStations(term))
  } catch (error) {
    next(error)
  }
})

const previewSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  fromExp: z.string().trim().optional(),
  fromEsr: z.string().trim().optional(),
  toExp: z.string().trim().optional(),
  toEsr: z.string().trim().optional(),
  date: z.string().trim().min(1),
  timeFrom: z.string().trim().optional(),
  timeTo: z.string().trim().optional(),
  searchUrl: z.string().trim().url().optional().or(z.literal('')),
})

app.post('/api/trains/preview', async (request, response, next) => {
  try {
    const input = previewSchema.parse(request.body)
    if (!input.searchUrl && (!input.from || !input.to)) {
      response.status(400).json({ message: 'Укажите станцию отправления и прибытия или ссылку поиска.' })
      return
    }
    response.json(await previewTrains({ ...input, searchUrl: input.searchUrl || undefined }))
  } catch (error) {
    next(error)
  }
})

app.get('/api/tasks', async (_request, response, next) => {
  try {
    response.json(await readTasks())
  } catch (error) {
    next(error)
  }
})

app.post('/api/tasks', async (request, response, next) => {
  try {
    if (isCreatingTask) {
      response.status(409).json({ message: 'Задача уже создается. Подождите пару секунд.' })
      return
    }
    isCreatingTask = true
    const createToken = z.string().uuid().parse(request.body.createToken)
    if (!createTokens.delete(createToken)) {
      response.status(409).json({ message: 'Форма устарела. Обновите страницу и запустите мониторинг еще раз.' })
      return
    }

    const input = watchSchema.parse(request.body)
    const tasks = await readTasks()
    const runningTask = tasks.find((task) => runningStatuses.has(task.status))

    if (runningTask) {
      response.status(409).json({ message: 'Сначала остановите текущую задачу мониторинга.' })
      return
    }

    if (input.mode === 'link' && !input.searchUrl) {
      response.status(400).json({ message: 'Для режима по ссылке вставьте ссылку поиска с pass.rw.by.' })
      return
    }

    if (input.mode !== 'link' && (!input.from || !input.to)) {
      response.status(400).json({ message: 'Для режима по описанию укажите станцию отправления и прибытия.' })
      return
    }

    const now = new Date().toISOString()
    const task: WatchTask = {
      id: crypto.randomUUID(),
      ...input,
      searchUrl: input.searchUrl || undefined,
      mode: input.mode === 'route' || input.mode === 'train' ? 'description' : input.mode,
      foundNotificationCount: 0,
      checkCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    tasks.unshift(task)
    await writeTasks(tasks)
    response.status(201).json(task)
  } catch (error) {
    next(error)
  } finally {
    isCreatingTask = false
  }
})

app.post('/api/tasks/stop-running', async (_request, response, next) => {
  try {
    const now = new Date().toISOString()
    const tasks = await readTasks()
    const updatedTasks = tasks.map((task) =>
      runningStatuses.has(task.status)
        ? {
            ...task,
            status: 'expired' as const,
            updatedAt: now,
          }
        : task,
    )
    await writeTasks(updatedTasks)
    response.json({ stopped: tasks.filter((task) => runningStatuses.has(task.status)).length })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/tasks/:id', async (request, response, next) => {
  try {
    const status = z.enum(['active', 'paused', 'found', 'completed', 'expired', 'error']).parse(request.body.status)
    const task = await updateTask(request.params.id, { status })
    if (!task) {
      response.status(404).json({ message: 'Задача не найдена' })
      return
    }
    response.json(task)
  } catch (error) {
    next(error)
  }
})

app.post('/api/tasks/:id/check', async (request, response, next) => {
  try {
    const task = await runTaskNow(request.params.id)
    if (!task) {
      response.status(404).json({ message: 'Задача не найдена' })
      return
    }
    response.json(task)
  } catch (error) {
    next(error)
  }
})

app.post('/api/telegram/test', async (_request, response, next) => {
  try {
    await sendTelegramMessage('Тестовое сообщение от монитора билетов БЖД.')
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

const clientDistPath = join(process.cwd(), 'dist')
const clientIndexPath = join(clientDistPath, 'index.html')

if (existsSync(clientIndexPath)) {
  app.use(express.static(clientDistPath))
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(clientIndexPath)
  })
}

app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  void next
  if (error instanceof z.ZodError) {
    response.status(400).json({ message: 'Проверьте поля формы', details: error.issues })
    return
  }
  response.status(500).json({ message: error instanceof Error ? error.message : 'Внутренняя ошибка' })
})

startScheduler()

app.listen(config.port, () => {
  console.log(`Сервер монитора билетов запущен: http://localhost:${config.port}`)
})
