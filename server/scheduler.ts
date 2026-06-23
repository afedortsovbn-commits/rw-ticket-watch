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

function isRunnableStatus(task?: WatchTask) {
  return task?.status === 'active' || task?.status === 'found'
}

function nextCheckCount(task: WatchTask) {
  return (task.checkCount ?? 0) + 1
}

function reachedCheckLimit(checkCount: number) {
  return config.maxChecksPerTask > 0 && checkCount >= config.maxChecksPerTask
}

async function readCurrentTask(id: string) {
  return (await readTasks()).find((item) => item.id === id)
}

function canNotifyFailure(task: WatchTask) {
  if (!task.lastFailureNotifiedAt) {
    return true
  }
  return Date.now() - new Date(task.lastFailureNotifiedAt).getTime() >= config.telegramMinIntervalMs
}

function describeTask(task: WatchTask) {
  const route =
    task.mode === 'link'
      ? 'по ссылке pass.rw.by'
      : `${task.from ?? 'станция отправления'} -> ${task.to ?? 'станция прибытия'}`
  const train = task.trainNumber ? `, поезд ${task.trainNumber}` : ''
  const time = [task.timeFrom, task.timeTo].filter(Boolean).join('-')
  return `${route}${train}, ${task.date}${time ? `, ${time}` : ''}`
}

async function notifyFound(task: WatchTask) {
  const text = [
    'Появились билеты БЖД',
    describeTask(task),
    task.lastResult?.message,
    task.lastResult?.sourceUrl,
  ]
    .filter(Boolean)
    .join('\n')

  await sendTelegramMessage(text)
}

async function notifyFoundAndComplete(task: WatchTask) {
  if ((task.foundNotificationCount ?? 0) >= 1) {
    return
  }

  const now = new Date().toISOString()
  await notifyFound(task)
  await updateTask(task.id, {
    status: 'completed',
    completedAt: now,
    foundNotificationCount: 1,
    lastNotificationAt: now,
  })
}

async function notifyFailureAfterSuccess(task: WatchTask, error: unknown) {
  if (!task.lastHealthyAt || !canNotifyFailure(task)) {
    return
  }

  const message = error instanceof Error ? error.message : 'Неизвестная ошибка проверки'
  await sendTelegramMessage(
    [
      'Мониторинг БЖД перестал получать данные после успешного запуска.',
      describeTask(task),
      message,
      'Задача остается активной, я продолжу пробовать.',
    ].join('\n'),
  )
  await updateTask(task.id, { lastFailureNotifiedAt: new Date().toISOString() })
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

      if (reachedCheckLimit(task.checkCount ?? 0)) {
        await updateTask(task.id, { status: 'completed', completedAt: new Date().toISOString() })
        continue
      }

      try {
        const checkCount = nextCheckCount(task)
        const result = await checkTickets(task)
        const currentTask = await readCurrentTask(task.id)
        if (!isRunnableStatus(currentTask)) {
          continue
        }
        const status = result.hasTickets ? 'found' : reachedCheckLimit(checkCount) ? 'completed' : 'active'
        const updated = await updateTask(task.id, {
          status,
          checkCount,
          completedAt: status === 'completed' ? result.checkedAt : undefined,
          lastCheckedAt: result.checkedAt,
          lastResult: result,
          lastHealthyAt: result.checkedAt,
          error: undefined,
        })

        if (result.hasTickets && updated) {
          await notifyFoundAndComplete(updated)
        }
      } catch (error) {
        const currentTask = await readCurrentTask(task.id)
        if (!isRunnableStatus(currentTask)) {
          continue
        }
        const checkCount = nextCheckCount(task)
        await notifyFailureAfterSuccess(task, error)
        await updateTask(task.id, {
          status: reachedCheckLimit(checkCount) ? 'completed' : 'active',
          checkCount,
          completedAt: reachedCheckLimit(checkCount) ? new Date().toISOString() : undefined,
          error: error instanceof Error ? error.message : 'Неизвестная ошибка проверки',
        })
      }
    }
  } finally {
    isTicking = false
  }
}

function scheduleNext() {
  const jitter = Math.floor(Math.random() * Math.max(0, config.checkJitterMs))
  timer = setTimeout(async () => {
    await tick()
    scheduleNext()
  }, config.checkIntervalMs + jitter)
}

export function startScheduler() {
  if (timer) return
  scheduleNext()
  void tick()
}

export async function runTaskNow(id: string) {
  const task = await readCurrentTask(id)
  if (!task) {
    return undefined
  }
  if (!isRunnableStatus(task)) {
    return task
  }
  if (reachedCheckLimit(task.checkCount ?? 0)) {
    return updateTask(id, { status: 'completed', completedAt: new Date().toISOString() })
  }
  try {
    const checkCount = nextCheckCount(task)
    const result = await checkTickets(task)
    const currentTask = await readCurrentTask(id)
    if (!isRunnableStatus(currentTask)) {
      return currentTask
    }
    const updated = await updateTask(id, {
      status: result.hasTickets ? 'found' : reachedCheckLimit(checkCount) ? 'completed' : 'active',
      checkCount,
      completedAt: !result.hasTickets && reachedCheckLimit(checkCount) ? result.checkedAt : undefined,
      lastCheckedAt: result.checkedAt,
      lastResult: result,
      lastHealthyAt: result.checkedAt,
      error: undefined,
    })

    if (result.hasTickets && updated) {
      await notifyFoundAndComplete(updated)
      return (await readTasks()).find((item) => item.id === id)
    }

    return updated
  } catch (error) {
    const currentTask = await readCurrentTask(id)
    if (!isRunnableStatus(currentTask)) {
      return currentTask
    }
    const checkCount = nextCheckCount(task)
    await notifyFailureAfterSuccess(task, error)
    return updateTask(id, {
      status: reachedCheckLimit(checkCount) ? 'completed' : 'active',
      checkCount,
      completedAt: reachedCheckLimit(checkCount) ? new Date().toISOString() : undefined,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка проверки',
    })
  }
}
