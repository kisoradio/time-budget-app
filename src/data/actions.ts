/**
 * 画面から呼ぶ操作。すべて IndexedDB を直接更新し、
 * 「取り消し」トースト（§6.7）用に元に戻す関数を返す。
 */
import type { BudgetMap, Category, Cycle, Settings, TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'
import { nowIso, toIso, toMs } from '../domain/time'
import { runningEntries, runningEntryOf } from '../domain/cycles'
import { db, DEFAULT_SETTINGS, newId, TEMPLATE_ID, type TimeBudgetDB } from './db'

export type Undo = () => Promise<void>

export interface ActionResult {
  /** 画面に出す短い文（例「勉強を開始しました」） */
  message: string
  undo: Undo
}

async function touchLastAction(database: TimeBudgetDB, at: string) {
  const s = (await database.settings.get('settings')) ?? { ...DEFAULT_SETTINGS }
  await database.settings.put({ ...s, lastActionAt: at, updatedAt: at })
}

async function stopEntries(database: TimeBudgetDB, entries: TimeEntry[], endAt: string): Promise<TimeEntry[]> {
  const stopped: TimeEntry[] = []
  for (const e of entries) {
    // 開始より前で止めることはしない（0分の記録になる）
    const end = toMs(endAt) < toMs(e.startAt) ? e.startAt : endAt
    const updated = { ...e, endAt: end, updatedAt: nowIso() }
    await database.entries.put(updated)
    stopped.push(e)
  }
  return stopped
}

async function restoreEntries(database: TimeBudgetDB, originals: TimeEntry[]) {
  for (const e of originals) await database.entries.put({ ...e, updatedAt: nowIso() })
}

/**
 * 計測の開始（§6.2）。
 * concurrent=false: 動いている他の計測は自動停止。
 * concurrent=true（長押し）: 他を止めずに同時計測。
 * 睡眠カテゴリーは必ず他をすべて止める（§6.4）。
 */
export async function startMeasuring(
  category: Category,
  opts: { concurrent?: boolean; at?: string } = {},
  database: TimeBudgetDB = db,
): Promise<ActionResult> {
  const at = opts.at ?? nowIso()
  const isSleep = category.mode === 'sleep' || category.id === SLEEP_CATEGORY_ID
  const concurrent = !isSleep && !!opts.concurrent

  return database.transaction('rw', database.entries, database.settings, async () => {
    const all = await database.entries.toArray()
    if (runningEntryOf(all, category.id)) {
      // 同じカテゴリーは二重に計測しない（§6.3）
      return { message: `${category.name}はすでに計測中です`, undo: async () => {} }
    }
    const running = runningEntries(all)
    const toStop = concurrent ? [] : running
    const stoppedOriginals = await stopEntries(database, toStop, at)
    const entry: TimeEntry = {
      id: newId(),
      categoryId: category.id,
      startAt: at,
      endAt: null,
      kind: isSleep ? 'sleep' : 'manual',
      updatedAt: at,
    }
    await database.entries.put(entry)
    await touchLastAction(database, at)
    return {
      message: isSleep ? '就寝しました' : `${category.name}を開始しました`,
      undo: async () => {
        await database.transaction('rw', database.entries, async () => {
          await database.entries.delete(entry.id)
          await restoreEntries(database, stoppedOriginals)
        })
      },
    }
  })
}

/** 計測の停止 */
export async function stopMeasuring(entry: TimeEntry, categoryName: string, at: string = nowIso(), database: TimeBudgetDB = db): Promise<ActionResult> {
  const original = { ...entry }
  await database.transaction('rw', database.entries, database.settings, async () => {
    await stopEntries(database, [entry], at)
    await touchLastAction(database, at)
  })
  return {
    message: `${categoryName}を停止しました`,
    undo: async () => {
      await restoreEntries(database, [original])
    },
  }
}

/** 就寝（§6.4）：動いている計測をすべて止め、睡眠の計測を始める */
export async function goToBed(sleepCategory: Category, at: string = nowIso(), database: TimeBudgetDB = db): Promise<ActionResult> {
  return startMeasuring(sleepCategory, { at }, database)
}

/** 仮眠だった（§5.4）：睡眠の計測を止めるだけで、サイクルは切り替えない */
export async function endAsNap(sleepEntry: TimeEntry, at: string = nowIso(), database: TimeBudgetDB = db): Promise<ActionResult> {
  const r = await stopMeasuring(sleepEntry, '睡眠', at, database)
  return { ...r, message: '仮眠として記録しました' }
}

/**
 * 今日を開始（起床）（§5）。
 * - 睡眠が動いていれば起床時刻で止める。
 * - 睡眠が動いていなくて bedAt が渡されたら、就寝時刻の後入力として睡眠記録を作る（§5.5）。
 *   そのとき bedAt 以降も動いていた計測は bedAt で止める。
 * - 予算はテンプレートからコピーする（§4.2）。
 */
export async function startCycle(
  opts: { wakeAt?: string; bedAt?: string | null; manualCut?: boolean } = {},
  database: TimeBudgetDB = db,
): Promise<ActionResult & { cycle: Cycle }> {
  const wakeAt = opts.wakeAt ?? nowIso()
  return database.transaction('rw', database.entries, database.cycles, database.templates, database.settings, async () => {
    const all = await database.entries.toArray()
    const sleepRunning = runningEntryOf(all, SLEEP_CATEGORY_ID)
    const stoppedOriginals: TimeEntry[] = []
    let createdSleep: TimeEntry | null = null

    if (sleepRunning) {
      stoppedOriginals.push(...(await stopEntries(database, [sleepRunning], wakeAt)))
    } else if (opts.bedAt) {
      const bedAt = opts.bedAt
      // 就寝時刻以降も動いていた計測は就寝時刻で止める（§6.5）
      const stillRunning = runningEntries(all).filter((e) => e.categoryId !== SLEEP_CATEGORY_ID)
      stoppedOriginals.push(...(await stopEntries(database, stillRunning, bedAt)))
      if (toMs(wakeAt) > toMs(bedAt)) {
        createdSleep = {
          id: newId(),
          categoryId: SLEEP_CATEGORY_ID,
          startAt: bedAt,
          endAt: wakeAt,
          kind: 'sleep',
          updatedAt: wakeAt,
        }
        await database.entries.put(createdSleep)
      }
    } else if (opts.manualCut) {
      // 「ここで区切る」：動いている計測はそのまま続く（境界で分割されて表示される）
    }

    const template = await database.templates.get(TEMPLATE_ID)
    const cycle: Cycle = {
      id: newId(),
      wakeAt,
      budgets: { ...(template?.budgets ?? {}) },
      manualCut: !!opts.manualCut,
      updatedAt: wakeAt,
    }
    await database.cycles.put(cycle)
    await touchLastAction(database, wakeAt)
    return {
      cycle,
      message: opts.manualCut ? 'ここで区切りました' : '今日を開始しました',
      undo: async () => {
        await database.transaction('rw', database.entries, database.cycles, async () => {
          await database.cycles.delete(cycle.id)
          if (createdSleep) await database.entries.delete(createdSleep.id)
          await restoreEntries(database, stoppedOriginals)
        })
      },
    }
  })
}

/** 起床時刻の修正（§5.1）。所属の付け替えは表示時の計算で自動的に行われる（§14.2）。 */
export async function updateWakeAt(cycle: Cycle, wakeAt: string, database: TimeBudgetDB = db): Promise<ActionResult> {
  const original = { ...cycle }
  await database.transaction('rw', database.cycles, database.entries, async () => {
    await database.cycles.put({ ...cycle, wakeAt, updatedAt: nowIso() })
    // 起床で終わった睡眠記録があれば、終了時刻も合わせて動かす
    const sleep = await database.entries.where('categoryId').equals(SLEEP_CATEGORY_ID).and((e) => e.endAt === cycle.wakeAt).first()
    if (sleep && toMs(wakeAt) > toMs(sleep.startAt)) {
      await database.entries.put({ ...sleep, endAt: wakeAt, updatedAt: nowIso() })
    }
  })
  return {
    message: '起床時刻を修正しました',
    undo: async () => {
      await database.cycles.put({ ...original, updatedAt: nowIso() })
    },
  }
}

/** そのサイクルの予算を更新（過去のサイクルには影響しない） */
export async function updateCycleBudgets(cycle: Cycle, budgets: BudgetMap, database: TimeBudgetDB = db): Promise<void> {
  await database.cycles.put({ ...cycle, budgets: { ...budgets }, updatedAt: nowIso() })
}

export async function updateTemplateBudgets(budgets: BudgetMap, database: TimeBudgetDB = db): Promise<void> {
  const t = (await database.templates.get(TEMPLATE_ID)) ?? { id: TEMPLATE_ID, name: '基本', budgets: {}, updatedAt: '' }
  await database.templates.put({ ...t, budgets: { ...budgets }, updatedAt: nowIso() })
}

/** 計測記録の修正・削除・手動追加（§6.6） */
export async function upsertEntry(entry: TimeEntry, database: TimeBudgetDB = db): Promise<ActionResult> {
  const original = await database.entries.get(entry.id)
  await database.entries.put({ ...entry, updatedAt: nowIso() })
  return {
    message: original ? '記録を修正しました' : '記録を追加しました',
    undo: async () => {
      if (original) await database.entries.put(original)
      else await database.entries.delete(entry.id)
    },
  }
}

export async function deleteEntry(entry: TimeEntry, database: TimeBudgetDB = db): Promise<ActionResult> {
  await database.entries.delete(entry.id)
  return {
    message: '記録を削除しました',
    undo: async () => {
      await database.entries.put(entry)
    },
  }
}

export function newManualEntry(categoryId: string, startAt: string, endAt: string | null): TimeEntry {
  const at = nowIso()
  return {
    id: newId(),
    categoryId,
    startAt,
    endAt,
    kind: categoryId === SLEEP_CATEGORY_ID ? 'sleep' : 'manual',
    updatedAt: at,
  }
}

/** カテゴリーの追加・編集。削除はアーカイブ（§4.1）。 */
export async function saveCategory(category: Category, database: TimeBudgetDB = db): Promise<void> {
  await database.categories.put({ ...category, updatedAt: nowIso() })
}

export async function archiveCategory(category: Category, database: TimeBudgetDB = db): Promise<ActionResult> {
  if (category.id === SLEEP_CATEGORY_ID) throw new Error('睡眠はアーカイブできません')
  const original = { ...category }
  await database.transaction('rw', database.categories, database.entries, async () => {
    await database.categories.put({ ...category, archived: true, updatedAt: nowIso() })
    // 動いている計測があれば止める
    const running = await database.entries.where('categoryId').equals(category.id).and((e) => e.endAt === null).toArray()
    await stopEntries(database, running, nowIso())
  })
  return {
    message: `${category.name}をアーカイブしました`,
    undo: async () => {
      await database.categories.put({ ...original, updatedAt: nowIso() })
    },
  }
}

export async function reorderCategories(ordered: Category[], database: TimeBudgetDB = db): Promise<void> {
  const at = nowIso()
  await database.categories.bulkPut(ordered.map((c, i) => ({ ...c, order: c.id === SLEEP_CATEGORY_ID ? 9999 : i, updatedAt: at })))
}

export async function saveSettings(patch: Partial<Settings>, database: TimeBudgetDB = db): Promise<void> {
  const s = (await database.settings.get('settings')) ?? { ...DEFAULT_SETTINGS }
  await database.settings.put({ ...s, ...patch, id: 'settings', updatedAt: nowIso() })
}

export function isoFromMs(ms: number): string {
  return toIso(ms)
}
