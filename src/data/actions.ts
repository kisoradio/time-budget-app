/**
 * 画面から呼ぶ操作。すべて IndexedDB を直接更新し、
 * 「取り消し」トースト（§6.7）用に元に戻す関数を返す。
 */
import type { BudgetMap, Category, Cycle, Settings, TimeEntry } from '../domain/types'
import { SLEEP_CATEGORY_ID } from '../domain/types'
import { formatClock, nowIso, toIso, toMs } from '../domain/time'
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
 * 睡眠も他のタイマーと同じ扱い（本人の要望で §6.4 を変更）。1日を締めるのは closeDay（おやすみ）。
 */
export async function startMeasuring(
  category: Category,
  opts: { concurrent?: boolean; at?: string } = {},
  database: TimeBudgetDB = db,
): Promise<ActionResult> {
  const at = opts.at ?? nowIso()
  const isSleep = category.mode === 'sleep' || category.id === SLEEP_CATEGORY_ID
  const concurrent = !!opts.concurrent

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
      message: `${category.name}を開始しました`,
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

/**
 * おやすみ（1日を締める）。本人の要望で、睡眠の開始と1日の終わりを分けた設計。
 * - 今日のまとめで決めた繰り越しをサイクルに記録する（次の起床で新しいサイクルへ引き継ぐ）
 * - 動いている計測をすべて止め、睡眠の計測を始める（睡眠がすでに動いていればそのまま）
 */
export async function closeDay(cycle: Cycle, nextCarryover: BudgetMap, at: string = nowIso(), database: TimeBudgetDB = db): Promise<ActionResult> {
  return database.transaction('rw', database.entries, database.cycles, database.settings, async () => {
    const fresh = (await database.cycles.get(cycle.id)) ?? cycle
    const originalCycle = { ...fresh }
    const all = await database.entries.toArray()
    const sleepRunning = runningEntryOf(all, SLEEP_CATEGORY_ID)
    const toStop = runningEntries(all).filter((e) => e.categoryId !== SLEEP_CATEGORY_ID)
    const stoppedOriginals = await stopEntries(database, toStop, at)
    let createdSleep: TimeEntry | null = null
    if (!sleepRunning) {
      createdSleep = { id: newId(), categoryId: SLEEP_CATEGORY_ID, startAt: at, endAt: null, kind: 'sleep', updatedAt: at }
      await database.entries.put(createdSleep)
    }
    await database.cycles.put({ ...fresh, closedAt: at, nextCarryover: { ...nextCarryover }, updatedAt: nowIso() })
    await touchLastAction(database, at)
    return {
      message: 'おやすみなさい',
      undo: async () => {
        await database.transaction('rw', database.entries, database.cycles, async () => {
          if (createdSleep) await database.entries.delete(createdSleep.id)
          await restoreEntries(database, stoppedOriginals)
          const cur = (await database.cycles.get(cycle.id)) ?? originalCycle
          await database.cycles.put({ ...cur, closedAt: originalCycle.closedAt ?? null, nextCarryover: originalCycle.nextCarryover, updatedAt: nowIso() })
        })
      },
    }
  })
}

/** おやすみを取り消して1日を続ける（睡眠の計測はそのまま） */
export async function reopenDay(cycle: Cycle, database: TimeBudgetDB = db): Promise<ActionResult> {
  const fresh = (await database.cycles.get(cycle.id)) ?? cycle
  const original = { ...fresh }
  await database.cycles.put({ ...fresh, closedAt: null, updatedAt: nowIso() })
  return {
    message: '1日を続けます',
    undo: async () => {
      const cur = (await database.cycles.get(cycle.id)) ?? original
      await database.cycles.put({ ...cur, closedAt: original.closedAt ?? null, updatedAt: nowIso() })
    },
  }
}

/** 繰り越しをリセットする（カテゴリー指定なしなら全部）（§9） */
export async function resetCarryover(cycle: Cycle, categoryId?: string, database: TimeBudgetDB = db): Promise<ActionResult> {
  const fresh = (await database.cycles.get(cycle.id)) ?? cycle
  const original = { ...(fresh.carryover ?? {}) }
  const next = { ...original }
  if (categoryId) delete next[categoryId]
  else for (const k of Object.keys(next)) delete next[k]
  await database.cycles.put({ ...fresh, carryover: next, updatedAt: nowIso() })
  return {
    message: '繰り越しをリセットしました',
    undo: async () => {
      const cur = (await database.cycles.get(cycle.id)) ?? fresh
      await database.cycles.put({ ...cur, carryover: original, updatedAt: nowIso() })
    },
  }
}

/**
 * 今日を開始（起床）（§5）。
 * - 睡眠が動いていれば起床時刻で止める。
 * - 睡眠が動いていなくて bedAt が渡されたら、就寝時刻の後入力として睡眠記録を作る（§5.5）。
 *   そのとき bedAt 以降も動いていた計測は bedAt で止める。
 * - 予算はテンプレートからコピーする（§4.2）。
 */
export async function startCycle(
  opts: { wakeAt?: string; bedAt?: string | null; manualCut?: boolean; carryover?: BudgetMap } = {},
  database: TimeBudgetDB = db,
): Promise<ActionResult & { cycle: Cycle }> {
  const wakeAt = opts.wakeAt ?? nowIso()
  return database.transaction('rw', database.entries, database.cycles, database.templates, database.settings, async () => {
    const all = await database.entries.toArray()
    // 繰り越し：指定があればそれ、なければ前のサイクルの「おやすみ」で決めた分
    const prev = (await database.cycles.toArray()).sort((a, b) => toMs(b.wakeAt) - toMs(a.wakeAt))[0]
    const carryover = { ...(opts.carryover ?? prev?.nextCarryover ?? {}) }
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
    // 手動の区切りは同じ日の続きなので、繰り越しを引き継ぐ
    if (opts.manualCut && !opts.carryover && prev?.carryover) Object.assign(carryover, prev.carryover)
    const cycle: Cycle = {
      id: newId(),
      wakeAt,
      budgets: { ...(template?.budgets ?? {}) },
      manualCut: !!opts.manualCut,
      carryover,
      nextCarryover: {},
      closedAt: null,
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
  const originalWakeAt = cycle.wakeAt
  await database.transaction('rw', database.cycles, database.entries, async () => {
    // 画面が持っている古いコピーで予算などを上書きしないよう、保存されている最新を読んでから起床時刻だけ変える
    const fresh = (await database.cycles.get(cycle.id)) ?? cycle
    await database.cycles.put({ ...fresh, wakeAt, updatedAt: nowIso() })
    // 起床で終わった睡眠記録があれば、終了時刻も合わせて動かす
    const sleep = await database.entries.where('categoryId').equals(SLEEP_CATEGORY_ID).and((e) => e.endAt === fresh.wakeAt).first()
    if (sleep && toMs(wakeAt) > toMs(sleep.startAt)) {
      await database.entries.put({ ...sleep, endAt: wakeAt, updatedAt: nowIso() })
    }
  })
  return {
    message: '起床時刻を修正しました',
    undo: async () => {
      const fresh = (await database.cycles.get(cycle.id)) ?? cycle
      await database.cycles.put({ ...fresh, wakeAt: originalWakeAt, updatedAt: nowIso() })
    },
  }
}

/** そのサイクルの予算を更新（過去のサイクルには影響しない）。起床時刻など他の項目は触らない。 */
export async function updateCycleBudgets(cycle: Cycle, budgets: BudgetMap, database: TimeBudgetDB = db): Promise<void> {
  const fresh = (await database.cycles.get(cycle.id)) ?? cycle
  await database.cycles.put({ ...fresh, budgets: { ...budgets }, updatedAt: nowIso() })
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

/**
 * そのサイクルでのカテゴリー別合計を、指定した長さに合わせる（カードの「合計時間を調整」）。
 * - 増やすとき：直近の記録の開始時刻を早める（起床時刻より前にはしない）。
 *   止まっている記録で足りなければ終了時刻を今まで遅らせる。記録がなければ今で終わる記録を作る。
 *   それでも足りない（起床から今までの時間より多い）ときは、moveWakeEarlier が true なら
 *   起床時刻をその分だけ早めて入れる。false なら入る分だけ入れ、shortfallMs に残りを返す。
 * - 減らすとき：直近の記録から縮める。0 になった記録は削除し、さらに前の記録を縮める。
 */
export async function adjustCategoryTotal(
  category: Category,
  cycle: Cycle,
  targetMs: number,
  nowMs: number = Date.now(),
  opts: { moveWakeEarlier?: boolean } = {},
  database: TimeBudgetDB = db,
): Promise<ActionResult & { shortfallMs: number; wakeMovedTo: string | null }> {
  const target = Math.max(0, Math.round(targetMs / 60_000) * 60_000)
  return database.transaction('rw', database.entries, database.cycles, database.settings, async () => {
    const freshCycle = (await database.cycles.get(cycle.id)) ?? cycle
    const originalCycle = { ...freshCycle }
    const wakeMs = toMs(freshCycle.wakeAt)
    const all = (await database.entries.where('categoryId').equals(category.id).toArray()).filter((e) => {
      const end = e.endAt === null ? nowMs : toMs(e.endAt)
      return end > wakeMs && toMs(e.startAt) < nowMs
    })
    // サイクル内の長さだけを数える（境界をまたぐ記録は起床以降の分）
    const inCycle = (e: TimeEntry) => Math.max(0, (e.endAt === null ? nowMs : toMs(e.endAt)) - Math.max(wakeMs, toMs(e.startAt)))
    const current = all.reduce((sum, e) => sum + inCycle(e), 0)
    let delta = target - current
    const originals: TimeEntry[] = []
    const deleted: TimeEntry[] = []
    const created: TimeEntry[] = []
    let sleepOriginal: TimeEntry | null = null
    let wakeMovedTo: string | null = null
    const sorted = [...all].sort((a, b) => toMs(b.startAt) - toMs(a.startAt))

    if (delta > 0) {
      // 起床時刻まで広げた記録（足りないときに、起床を早めてさらに広げる対象）
      let anchor: TimeEntry | null = null
      const latest = sorted[0]
      if (latest) {
        originals.push({ ...latest })
        let startMs = toMs(latest.startAt)
        const canEarlier = Math.max(0, startMs - wakeMs)
        const earlier = Math.min(delta, canEarlier)
        startMs -= earlier
        delta -= earlier
        let endAt = latest.endAt
        if (delta > 0 && endAt !== null) {
          const endMs = toMs(endAt)
          const later = Math.min(delta, Math.max(0, nowMs - endMs))
          endAt = toIso(endMs + later)
          delta -= later
        }
        const updated = { ...latest, startAt: toIso(startMs), endAt, updatedAt: nowIso() }
        await database.entries.put(updated)
        if (startMs <= wakeMs) anchor = updated
      }
      if (delta > 0) {
        const startMs = Math.max(wakeMs, nowMs - delta)
        if (nowMs > startMs) {
          const e: TimeEntry = { id: newId(), categoryId: category.id, startAt: toIso(startMs), endAt: toIso(nowMs), kind: category.mode === 'sleep' ? 'sleep' : 'manual', updatedAt: nowIso() }
          await database.entries.put(e)
          created.push(e)
          delta -= nowMs - startMs
          if (startMs <= wakeMs) anchor = e
        }
      }
      if (delta > 0 && opts.moveWakeEarlier) {
        // 起床から今までの時間より多い分は、起床時刻をその分だけ早めて入れる
        const newWakeMs = wakeMs - delta
        const newWakeAt = toIso(newWakeMs)
        await database.cycles.put({ ...freshCycle, wakeAt: newWakeAt, updatedAt: nowIso() })
        // 起床で終わった睡眠があれば、終了時刻も合わせて早める
        const sleep = await database.entries.where('categoryId').equals(SLEEP_CATEGORY_ID).and((e) => e.endAt === freshCycle.wakeAt).first()
        if (sleep && newWakeMs > toMs(sleep.startAt)) {
          sleepOriginal = { ...sleep }
          await database.entries.put({ ...sleep, endAt: newWakeAt, updatedAt: nowIso() })
        }
        if (anchor) {
          await database.entries.put({ ...anchor, startAt: newWakeAt, updatedAt: nowIso() })
        } else {
          const e: TimeEntry = { id: newId(), categoryId: category.id, startAt: newWakeAt, endAt: freshCycle.wakeAt, kind: 'manual', updatedAt: nowIso() }
          await database.entries.put(e)
          created.push(e)
        }
        wakeMovedTo = newWakeAt
        delta = 0
      }
    } else if (delta < 0) {
      let remain = -delta
      for (const e of sorted) {
        if (remain <= 0) break
        const len = inCycle(e)
        if (len <= remain) {
          // 丸ごと消す（起床前にはみ出した分があれば、起床時刻で切る）
          if (toMs(e.startAt) < wakeMs) {
            originals.push({ ...e })
            await database.entries.put({ ...e, endAt: freshCycle.wakeAt, updatedAt: nowIso() })
          } else {
            deleted.push({ ...e })
            await database.entries.delete(e.id)
          }
          remain -= len
        } else {
          originals.push({ ...e })
          if (e.endAt === null) {
            await database.entries.put({ ...e, startAt: toIso(toMs(e.startAt) + remain), updatedAt: nowIso() })
          } else {
            await database.entries.put({ ...e, endAt: toIso(toMs(e.endAt) - remain), updatedAt: nowIso() })
          }
          remain = 0
        }
      }
      delta = 0
    }
    await touchLastAction(database, nowIso())
    return {
      shortfallMs: Math.max(0, delta),
      wakeMovedTo,
      message: wakeMovedTo ? `${category.name}の合計を調整し、起床を ${formatClock(wakeMovedTo)} に早めました` : `${category.name}の合計を調整しました`,
      undo: async () => {
        await database.transaction('rw', database.entries, database.cycles, async () => {
          for (const e of created) await database.entries.delete(e.id)
          for (const e of deleted) await database.entries.put(e)
          await restoreEntries(database, originals)
          if (sleepOriginal) await database.entries.put(sleepOriginal)
          if (wakeMovedTo) {
            const cur = (await database.cycles.get(cycle.id)) ?? originalCycle
            await database.cycles.put({ ...cur, wakeAt: originalCycle.wakeAt, updatedAt: nowIso() })
          }
        })
      },
    }
  })
}

/**
 * 新しいタイマーの予算を、今のサイクルとテンプレートの両方に入れる。
 * 「追加のときに一緒に時間も決めたい」という要望に合わせたもの。
 */
export async function setBudgetForNewCategory(categoryId: string, minutes: number, database: TimeBudgetDB = db): Promise<void> {
  const min = Math.max(0, Math.round(minutes))
  await database.transaction('rw', database.cycles, database.templates, async () => {
    const cycles = await database.cycles.toArray()
    const current = cycles.sort((a, b) => toMs(b.wakeAt) - toMs(a.wakeAt))[0]
    if (current) await database.cycles.put({ ...current, budgets: { ...current.budgets, [categoryId]: min }, updatedAt: nowIso() })
    const t = (await database.templates.get(TEMPLATE_ID)) ?? { id: TEMPLATE_ID, name: '基本', budgets: {}, updatedAt: '' }
    await database.templates.put({ ...t, budgets: { ...t.budgets, [categoryId]: min }, updatedAt: nowIso() })
  })
}
