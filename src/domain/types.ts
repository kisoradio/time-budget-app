// すべての時刻は ISO 8601 の UTC 文字列（例: "2026-10-15T22:30:00.000Z"）で保存する。
export type IsoUtc = string

export type MeasureMode = 'stopwatch' | 'timer' | 'sleep'
export type EntryKind = 'manual' | 'pomodoro' | 'sleep'

export const SLEEP_CATEGORY_ID = 'sleep'

export interface Category {
  id: string
  name: string
  color: string
  order: number
  mode: MeasureMode
  protect: boolean
  archived: boolean
  updatedAt: IsoUtc
}

/** カテゴリーidごとの分数 */
export type BudgetMap = Record<string, number>

export interface BudgetTemplate {
  id: string
  name: string
  budgets: BudgetMap
  updatedAt: IsoUtc
}

export interface Cycle {
  id: string
  wakeAt: IsoUtc
  budgets: BudgetMap
  manualCut: boolean
  updatedAt: IsoUtc
}

export interface TimeEntry {
  id: string
  categoryId: string
  startAt: IsoUtc
  endAt: IsoUtc | null
  kind: EntryKind
  note?: string
  updatedAt: IsoUtc
}

export interface Settings {
  id: 'settings'
  schemaVersion: number
  /** 止め忘れ検知の閾値（分）。既定 240 */
  forgotThresholdMinutes: number
  /** 睡眠の止め忘れ検知の閾値（分）。既定 840 */
  sleepForgotThresholdMinutes: number
  lastBackupAt: IsoUtc | null
  /** 最後にユーザーが操作した時刻（就寝時刻の初期値に使う） */
  lastActionAt: IsoUtc | null
  updatedAt: IsoUtc
}

export const SCHEMA_VERSION = 1
export const DAY_MINUTES = 1440
