import type { BudgetTemplate, Category, Cycle, Settings, TimeEntry } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import { nowIso } from '../domain/time'
import { db, DEFAULT_SETTINGS, ensureSeeded, type TimeBudgetDB } from './db'

export interface BackupFile {
  app: 'time-budget-app'
  schemaVersion: number
  exportedAt: string
  categories: Category[]
  templates: BudgetTemplate[]
  cycles: Cycle[]
  entries: TimeEntry[]
  settings: Settings | null
}

export async function exportBackup(database: TimeBudgetDB = db): Promise<BackupFile> {
  const [categories, templates, cycles, entries, settings] = await Promise.all([
    database.categories.toArray(),
    database.templates.toArray(),
    database.cycles.toArray(),
    database.entries.toArray(),
    database.settings.get('settings'),
  ])
  return {
    app: 'time-budget-app',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    categories,
    templates,
    cycles,
    entries,
    settings: settings ?? null,
  }
}

export function backupFileName(exportedAt: string): string {
  const d = new Date(exportedAt)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `time-budget-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

/** 読み込むファイルの形式を確かめる。古いスキーマはここで変換する。 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('JSONとして読み取れませんでした')
  }
  if (!raw || typeof raw !== 'object') throw new Error('バックアップの形式ではありません')
  const obj = raw as Partial<BackupFile>
  if (obj.app !== 'time-budget-app') throw new Error('このアプリのバックアップではありません')
  const version = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0
  if (version > SCHEMA_VERSION) throw new Error('新しいバージョンのアプリで作られたファイルです。アプリを更新してください')
  // v1 より古い形式はまだ存在しないが、将来の変換はここに追加する
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    app: 'time-budget-app',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : nowIso(),
    categories: arr<Category>(obj.categories),
    templates: arr<BudgetTemplate>(obj.templates),
    cycles: arr<Cycle>(obj.cycles),
    entries: arr<TimeEntry>(obj.entries),
    settings: obj.settings && typeof obj.settings === 'object' ? (obj.settings as Settings) : null,
  }
}

/** 上書きで取り込む（§14.3。v0.1 は上書きのみ）。 */
export async function importBackupOverwrite(backup: BackupFile, database: TimeBudgetDB = db): Promise<void> {
  await database.transaction('rw', database.categories, database.templates, database.cycles, database.entries, database.settings, async () => {
    await Promise.all([
      database.categories.clear(),
      database.templates.clear(),
      database.cycles.clear(),
      database.entries.clear(),
      database.settings.clear(),
    ])
    await database.categories.bulkPut(backup.categories)
    await database.templates.bulkPut(backup.templates)
    await database.cycles.bulkPut(backup.cycles)
    await database.entries.bulkPut(backup.entries)
    const settings: Settings = { ...DEFAULT_SETTINGS, ...(backup.settings ?? {}), id: 'settings', schemaVersion: SCHEMA_VERSION, updatedAt: nowIso() }
    await database.settings.put(settings)
  })
  await ensureSeeded(database)
}

/** すべてのデータを消す（設定も初期値に戻す）。 */
export async function clearAllData(database: TimeBudgetDB = db): Promise<void> {
  await database.transaction('rw', database.categories, database.templates, database.cycles, database.entries, database.settings, async () => {
    await Promise.all([
      database.categories.clear(),
      database.templates.clear(),
      database.cycles.clear(),
      database.entries.clear(),
      database.settings.clear(),
    ])
  })
  await ensureSeeded(database)
}
