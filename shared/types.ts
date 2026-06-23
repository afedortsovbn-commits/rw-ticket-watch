export type WatchStatus = 'active' | 'paused' | 'found' | 'completed' | 'expired' | 'error'

export type WatchMode = 'description' | 'link' | 'route' | 'train'

export interface StationOption {
  value: string
  exp: string
  ecp?: string
  label?: string
}

export interface WatchInput {
  mode: WatchMode
  from?: string
  to?: string
  fromExp?: string
  fromEsr?: string
  toExp?: string
  toEsr?: string
  trainNumber?: string
  trainNumbers?: string[]
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
  checkCount?: number
}

export interface TrainInfo {
  number: string
  departure: string
  arrival: string
  hasPlaces: boolean
  freeSeats: number
  places: string
}

export interface CheckResult {
  hasTickets: boolean
  message: string
  sourceUrl: string
  checkedAt: string
  matches: string[]
  trains?: TrainInfo[]
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
  maxChecksPerTask: number
}
