import type { WatchTask } from '../shared/types.js'
import { checkTickets } from './checker.js'
import { config } from './config.js'
import { readTasks, updateTask } from './store.js'
import { sendTelegramMessage } from './telegram.js'

let timer: NodeJS.Timeout | undefined
let isTicking = false

function isExpired(task: WatchTask) {
  return new Date(task.monitorUntil).getTime() <= Date.now()
}

function canNotify(task: WatchTask) {
  if (!task.lastNotificationAt) {
    return true
  }
  return Date.now() - new Date(task.lastNotificationAt).getTime() >= config.telegramMinIntervalMs
}

function describeTask(task: WatchTask) {
  const route =
    task.mode === 'train'
      ? `поезд ${task.trainNumber}`
      : `${task.from ?? 'станция отправления'} -> ${task.to ?? 'станция прибытия'}`
  const time = [task.timeFrom, task.timeTo].filter(Boolean).join('-')
  return `${route}, ${task.date}${time ? `, ${time}` : ''}`
}

async function notify(task: WatchTask) {
  const text = [
    'Появились билеты БЖД',
    describeTask(task),
    task.lastResult?.message,
    task.lastResult?.sourceUrl,
  ]
    .filter(Boolean)
    .join('\n')

  await sendTelegramMessage(text)
  await updateTask(task.id, { lastNotificationAt: new Date().toISOString() })
}

async function tick() {
  if (isTicking) return
  isTicking = true
  try {
    const tasks = await readTasks()
    const activeTasks = tasks.filter((task) => task.status === 'active' || task.status === 'found')

    for (const task of activeTasks) {
      if (isExpired(task)) {
        await updateTask(task.id, { status: 'expired' })
        continue
      }

      try {
        const result = await checkTickets(task)
        const status = result.hasTickets ? 'found' : 'active'
        const updated = await updateTask(task.id, {
          status,
          lastCheckedAt: result.checkedAt,
          lastResult: result,
          error: undefined,
        })

        if (result.hasTickets && updated && canNotify(updated)) {
          await notify(updated)
        }
      } catch (error) {
        await updateTask(task.id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Неизвестная ошибка проверки',
        })
      }
    }
  } finally {
    isTicking = false
  }
}

export function startScheduler() {
  if (timer) return
  timer = setInterval(tick, config.checkIntervalMs)
  void tick()
}

export async function runTaskNow(id: string) {
  const task = (await readTasks()).find((item) => item.id === id)
  if (!task) {
    return undefined
  }
  const result = await checkTickets(task)
  return updateTask(id, {
    status: result.hasTickets ? 'found' : 'active',
    lastCheckedAt: result.checkedAt,
    lastResult: result,
    error: undefined,
  })
}
