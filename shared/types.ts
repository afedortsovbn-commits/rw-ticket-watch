export type WatchStatus = 'active' | 'paused' | 'found' | 'completed' | 'expired' | 'error'

export type WatchMode = 'description' | 'link' | 'route' | 'train'

export interface WatchInput {
  mode: WatchMode
  from?: string
  to?: string
  trainNumber?: string
  date: string
  timeFrom?: string
  timeTo?: string
  monitorUntil: string
  searchUrl?: string
  comment?: string
  foundNotificationCount?: number
  lastHealthyAt?: string
  lastFailureNotifiedAt?: string
  completedAt?: string
}

export interface CheckResult {
  hasTickets: boolean
  message: string
  sourceUrl: string
  checkedAt: string
  matches: string[]
}

export interface WatchTask extends WatchInput {
  id: string
  status: WatchStatus
  createdAt: string
  updatedAt: string
  lastCheckedAt?: string
  lastResult?: CheckResult
  lastNotificationAt?: string
  error?: string
}

export interface AppSettings {
  telegramBotToken: string
  telegramChatId: string
  checkIntervalMs: number
  telegramMinIntervalMs: number
}
