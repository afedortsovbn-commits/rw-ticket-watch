import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WatchTask } from '../shared/types.js'

const dbPath = join(process.cwd(), 'data', 'watch-tasks.json')

async function ensureDb() {
  await mkdir(dirname(dbPath), { recursive: true })
}

export async function readTasks(): Promise<WatchTask[]> {
  await ensureDb()
  try {
    const raw = await readFile(dbPath, 'utf8')
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as WatchTask[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function writeTasks(tasks: WatchTask[]) {
  await ensureDb()
  await writeFile(dbPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8')
}

export async function updateTask(id: string, patch: Partial<WatchTask>) {
  const tasks = await readTasks()
  const index = tasks.findIndex((task) => task.id === id)
  if (index === -1) {
    return undefined
  }
  tasks[index] = { ...tasks[index], ...patch, updatedAt: new Date().toISOString() }
  await writeTasks(tasks)
  return tasks[index]
}
