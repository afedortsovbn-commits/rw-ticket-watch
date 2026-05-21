import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { WatchTask } from '../shared/types.js'
import { config } from './config.js'
import { runTaskNow, startScheduler } from './scheduler.js'
import { readTasks, updateTask, writeTasks } from './store.js'
import { isTelegramConfigured, sendTelegramMessage } from './telegram.js'

const app = express()

app.use(cors())
app.use(express.json())

const watchSchema = z.object({
  mode: z.enum(['route', 'train']),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  trainNumber: z.string().trim().optional(),
  date: z.string().trim().min(1),
  timeFrom: z.string().trim().optional(),
  timeTo: z.string().trim().optional(),
  monitorUntil: z.string().trim().min(1),
  searchUrl: z.string().trim().url().optional().or(z.literal('')),
  comment: z.string().trim().optional(),
})

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    telegramConfigured: isTelegramConfigured(),
    checkIntervalMs: config.checkIntervalMs,
    telegramMinIntervalMs: config.telegramMinIntervalMs,
  })
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
    const input = watchSchema.parse(request.body)
    const now = new Date().toISOString()
    const task: WatchTask = {
      id: crypto.randomUUID(),
      ...input,
      searchUrl: input.searchUrl || undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    const tasks = await readTasks()
    tasks.unshift(task)
    await writeTasks(tasks)
    response.status(201).json(task)
  } catch (error) {
    next(error)
  }
})

app.patch('/api/tasks/:id', async (request, response, next) => {
  try {
    const status = z.enum(['active', 'paused', 'found', 'expired', 'error']).parse(request.body.status)
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

app.use((error: unknown, _request: express.Request, response: express.Response) => {
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
