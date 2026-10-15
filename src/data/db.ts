import Dexie, { type EntityTable } from 'dexie'
import type { BudgetTemplate, Category, Cycle, Settings, TimeEntry } from '../domain/types'
import { SCHEMA_VERSION, SLEEP_CATEGORY_ID } from '../domain/types'
import { nowIso } from '../domain/time'

export const TEMPLATE_ID = 'default'

export class TimeBudgetDB extends Dexie {
  categories!: EntityTable<Category, 'id'>
  templates!: EntityTable<BudgetTemplate, 'id'>
  cycles!: EntityTable<Cycle, 'id'>
  entries!: EntityTable<TimeEntry, 'id'>
  settings!: EntityTable<Settings, 'id'>

  constructor(name = 'time-budget') {
    super(name)
    // スキーマ v1（仕様 §14.1）。項目を増やすときは version(2) を追加して upgrade を書く。
    this.version(1).stores({
      categories: 'id, order, archived',
      templates: 'id',
      cycles: 'id, wakeAt',
      entries: 'id, categoryId, startAt, endAt',
      settings: 'id',
    })
  }
}

export const db = new TimeBudgetDB()

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  schemaVersion: SCHEMA_VERSION,
  forgotThresholdMinutes: 240,
  sleepForgotThresholdMinutes: 840,
  lastBackupAt: null,
  lastActionAt: null,
  updatedAt: '',
}

/** 初期カテゴリー（§4.1 の例）。睡眠は組み込みで削除不可。 */
export function defaultCategories(at: string): Category[] {
  return [
    { id: newId(), name: '仕事', color: '#6a8caf', order: 0, mode: 'stopwatch', protect: false, archived: false, updatedAt: at },
    { id: newId(), name: '勉強', color: '#f2c14e', order: 1, mode: 'stopwatch', protect: true, archived: false, updatedAt: at },
    { id: newId(), name: '運動', color: '#8fbc8f', order: 2, mode: 'stopwatch', protect: false, archived: false, updatedAt: at },
    { id: newId(), name: '趣味・娯楽', color: '#e07a5f', order: 3, mode: 'timer', protect: false, archived: false, updatedAt: at },
    { id: SLEEP_CATEGORY_ID, name: '睡眠', color: '#5b5f97', order: 9999, mode: 'sleep', protect: true, archived: false, updatedAt: at },
  ]
}

/** 初回起動時に初期データを入れる。既にあれば何もしない。 */
export async function ensureSeeded(database: TimeBudgetDB = db): Promise<void> {
  await database.transaction('rw', database.categories, database.templates, database.settings, async () => {
    const at = nowIso()
    const settings = await database.settings.get('settings')
    if (!settings) await database.settings.put({ ...DEFAULT_SETTINGS, updatedAt: at })

    const count = await database.categories.count()
    let categories = await database.categories.toArray()
    if (count === 0) {
      categories = defaultCategories(at)
      await database.categories.bulkPut(categories)
    } else if (!categories.some((c) => c.id === SLEEP_CATEGORY_ID)) {
      const sleep = defaultCategories(at).find((c) => c.id === SLEEP_CATEGORY_ID)!
      await database.categories.put(sleep)
      categories.push(sleep)
    }

    const template = await database.templates.get(TEMPLATE_ID)
    if (!template) {
      const budgets: Record<string, number> = {}
      for (const c of categories) {
        if (c.mode === 'sleep') budgets[c.id] = 420
        else if (c.name === '仕事') budgets[c.id] = 480
        else if (c.name === '勉強') budgets[c.id] = 120
        else if (c.name === '運動') budgets[c.id] = 60
        else if (c.name === '趣味・娯楽') budgets[c.id] = 120
        else budgets[c.id] = 0
      }
      await database.templates.put({ id: TEMPLATE_ID, name: '基本', budgets, updatedAt: at })
    }
  })
}

/** 永続保存を要求する（§2）。結果は表示用に返す。 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}
