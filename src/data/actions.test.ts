import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { TimeBudgetDB, ensureSeeded } from './db'
import { adjustCategoryTotal, closeDay, reopenDay, resetCarryover, startCycle, startMeasuring, stopMeasuring, updateCycleBudgets, updateWakeAt } from './actions'
import { exportBackup, importBackupOverwrite, parseBackup, clearAllData } from './backup'
import { SLEEP_CATEGORY_ID } from '../domain/types'
import { deriveCycleRanges, splitEntries, summarizeCycle } from '../domain/cycles'
import { HOUR, toIso, toMs } from '../domain/time'

const T = (jst: string) => toMs(`${jst}+09:00`)
const iso = (jst: string) => toIso(T(jst))

let db: TimeBudgetDB
let n = 0

beforeEach(async () => {
  db = new TimeBudgetDB(`test-${++n}`)
  await ensureSeeded(db)
})

async function cat(name: string) {
  const c = await db.categories.filter((c) => c.name === name).first()
  if (!c) throw new Error(`category ${name} not found`)
  return c
}

describe('初期データ', () => {
  it('睡眠カテゴリーとテンプレートが用意される', async () => {
    const sleep = await db.categories.get(SLEEP_CATEGORY_ID)
    expect(sleep?.mode).toBe('sleep')
    const template = await db.templates.get('default')
    expect(template?.budgets[SLEEP_CATEGORY_ID]).toBe(420)
  })
})

describe('計測の開始・停止（§6.2）', () => {
  it('別のカードをタップすると前の計測が止まる', async () => {
    const work = await cat('仕事')
    const study = await cat('勉強')
    await startMeasuring(work, { at: iso('2026-10-15 08:00') }, db)
    await startMeasuring(study, { at: iso('2026-10-15 09:00') }, db)
    const entries = await db.entries.toArray()
    const w = entries.find((e) => e.categoryId === work.id)!
    const s = entries.find((e) => e.categoryId === study.id)!
    expect(w.endAt).toBe(iso('2026-10-15 09:00'))
    expect(s.endAt).toBeNull()
  })

  it('長押し（concurrent）なら前の計測を止めない', async () => {
    const work = await cat('仕事')
    const study = await cat('勉強')
    await startMeasuring(work, { at: iso('2026-10-15 08:00') }, db)
    await startMeasuring(study, { at: iso('2026-10-15 09:00'), concurrent: true }, db)
    const running = (await db.entries.toArray()).filter((e) => e.endAt === null)
    expect(running).toHaveLength(2)
  })

  it('同じカテゴリーは二重に計測しない（§6.3）', async () => {
    const work = await cat('仕事')
    await startMeasuring(work, { at: iso('2026-10-15 08:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 09:00'), concurrent: true }, db)
    expect(await db.entries.count()).toBe(1)
  })

  it('取り消すと開始が消え、止めた計測が復活する（§6.7）', async () => {
    const work = await cat('仕事')
    const study = await cat('勉強')
    await startMeasuring(work, { at: iso('2026-10-15 08:00') }, db)
    const r = await startMeasuring(study, { at: iso('2026-10-15 09:00') }, db)
    await r.undo()
    const entries = await db.entries.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].categoryId).toBe(work.id)
    expect(entries[0].endAt).toBeNull()
  })

  it('停止を取り消すと計測中に戻る', async () => {
    const work = await cat('仕事')
    await startMeasuring(work, { at: iso('2026-10-15 08:00') }, db)
    const e = (await db.entries.toArray())[0]
    const r = await stopMeasuring(e, work.name, iso('2026-10-15 09:00'), db)
    expect((await db.entries.get(e.id))!.endAt).not.toBeNull()
    await r.undo()
    expect((await db.entries.get(e.id))!.endAt).toBeNull()
  })
})

describe('就寝・起床・仮眠（§5）', () => {
  it('おやすみ → 起床で、睡眠が前のサイクルに計上され、新しいサイクルが始まる（§17-4）', async () => {
    const work = await cat('仕事')
    const r0 = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 09:00') }, db)
    await closeDay(r0.cycle, {}, iso('2026-10-15 23:00'), db)
    // おやすみで仕事は止まる
    const workEntry = (await db.entries.toArray()).find((e) => e.categoryId === work.id)!
    expect(workEntry.endAt).toBe(iso('2026-10-15 23:00'))

    await startCycle({ wakeAt: iso('2026-10-16 06:30') }, db)
    const cycles = await db.cycles.toArray()
    expect(cycles).toHaveLength(2)
    const ranges = deriveCycleRanges(cycles)
    const segs = splitEntries(await db.entries.toArray(), ranges, T('2026-10-16 07:00'))
    const d1 = summarizeCycle(ranges[0], segs, T('2026-10-16 07:00'))
    expect(d1.totalsMs[SLEEP_CATEGORY_ID]).toBe(7.5 * HOUR)
    const d2 = summarizeCycle(ranges[1], segs, T('2026-10-16 07:00'))
    expect(d2.totalsMs[SLEEP_CATEGORY_ID]).toBeUndefined()
    // 予算はテンプレートからコピーされる（§4.2）
    expect(cycles[1].budgets[SLEEP_CATEGORY_ID]).toBe(420)
  })

  it('睡眠カードのタップ（昼寝）ではサイクルが切り替わらない（§17-5 相当）', async () => {
    const sleep = (await db.categories.get(SLEEP_CATEGORY_ID))!
    await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(sleep, { at: iso('2026-10-15 14:00') }, db)
    const sleepEntry = (await db.entries.toArray()).find((e) => e.endAt === null)!
    await stopMeasuring(sleepEntry, '睡眠', iso('2026-10-15 14:30'), db)
    expect(await db.cycles.count()).toBe(1)
    const e = await db.entries.get(sleepEntry.id)
    expect(e!.endAt).toBe(iso('2026-10-15 14:30'))
    expect((await db.cycles.toArray())[0].closedAt ?? null).toBeNull()
  })

  it('就寝を押さずに寝た翌朝、就寝時刻を入力すると睡眠が記録され、動いていた計測はその時刻で止まる（§17-6）', async () => {
    const work = await cat('仕事')
    await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 20:00') }, db)
    await startCycle({ wakeAt: iso('2026-10-16 06:30'), bedAt: iso('2026-10-15 23:30') }, db)
    const entries = await db.entries.toArray()
    const workEntry = entries.find((e) => e.categoryId === work.id)!
    expect(workEntry.endAt).toBe(iso('2026-10-15 23:30'))
    const sleepEntry = entries.find((e) => e.categoryId === SLEEP_CATEGORY_ID)!
    expect(sleepEntry.startAt).toBe(iso('2026-10-15 23:30'))
    expect(sleepEntry.endAt).toBe(iso('2026-10-16 06:30'))
    expect(sleepEntry.kind).toBe('sleep')
  })

  it('起床時刻を修正すると、起床で終わった睡眠の終了時刻も合わせて動く（§17-2, 13）', async () => {
    const r0 = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await closeDay(r0.cycle, {}, iso('2026-10-15 23:00'), db)
    const r = await startCycle({ wakeAt: iso('2026-10-16 07:00') }, db)
    await updateWakeAt(r.cycle, iso('2026-10-16 06:30'), db)
    expect((await db.cycles.get(r.cycle.id))!.wakeAt).toBe(iso('2026-10-16 06:30'))
    const sleepEntry = (await db.entries.toArray()).find((e) => e.categoryId === SLEEP_CATEGORY_ID)!
    expect(sleepEntry.endAt).toBe(iso('2026-10-16 06:30'))
  })

  it('起床を取り消すと、サイクルが消えて睡眠の計測が再開する', async () => {
    const r0 = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await closeDay(r0.cycle, {}, iso('2026-10-15 23:00'), db)
    const r = await startCycle({ wakeAt: iso('2026-10-16 07:00') }, db)
    await r.undo()
    expect(await db.cycles.count()).toBe(1)
    const sleepEntry = (await db.entries.toArray()).find((e) => e.categoryId === SLEEP_CATEGORY_ID)!
    expect(sleepEntry.endAt).toBeNull()
  })
})

describe('バックアップ（§14.3, §17-15）', () => {
  it('エクスポートし、消去後にインポートして同じ状態に戻る', async () => {
    const work = await cat('仕事')
    await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 09:00') }, db)
    const backup = await exportBackup(db)
    const text = JSON.stringify(backup)

    await clearAllData(db)
    expect(await db.cycles.count()).toBe(0)
    expect(await db.entries.count()).toBe(0)

    await importBackupOverwrite(parseBackup(text), db)
    const after = await exportBackup(db)
    expect(after.categories).toEqual(backup.categories)
    expect(after.cycles).toEqual(backup.cycles)
    expect(after.entries).toEqual(backup.entries)
    expect(after.templates).toEqual(backup.templates)
  })

  it('別のアプリのファイルや壊れたJSONは拒否する', () => {
    expect(() => parseBackup('{')).toThrow()
    expect(() => parseBackup('{"app":"other"}')).toThrow()
    expect(() => parseBackup('{"app":"time-budget-app","schemaVersion":99}')).toThrow()
  })
})

describe('合計時間の調整', () => {
  it('増やすと直近の記録の開始が早まり、減らすと直近から縮む', async () => {
    const work = await cat('仕事')
    const r = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 09:00') }, db)
    const e = (await db.entries.toArray())[0]
    await stopMeasuring(e, work.name, iso('2026-10-15 10:00'), db)
    const now = T('2026-10-15 12:00')
    // 1:00 → 1:30
    await adjustCategoryTotal(work, r.cycle.wakeAt, 90 * 60_000, now, db)
    let w = (await db.entries.get(e.id))!
    expect(w.startAt).toBe(iso('2026-10-15 08:30'))
    expect(w.endAt).toBe(iso('2026-10-15 10:00'))
    // 1:30 → 0:20
    const r2 = await adjustCategoryTotal(work, r.cycle.wakeAt, 20 * 60_000, now, db)
    w = (await db.entries.get(e.id))!
    expect(w.endAt).toBe(iso('2026-10-15 08:50'))
    await r2.undo()
    w = (await db.entries.get(e.id))!
    expect(w.endAt).toBe(iso('2026-10-15 10:00'))
  })

  it('計測中の記録は開始時刻を動かして合わせる', async () => {
    const work = await cat('仕事')
    const r = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 09:00') }, db)
    const now = T('2026-10-15 09:30')
    await adjustCategoryTotal(work, r.cycle.wakeAt, 60 * 60_000, now, db)
    let w = (await db.entries.toArray())[0]
    expect(w.startAt).toBe(iso('2026-10-15 08:30'))
    expect(w.endAt).toBeNull()
    await adjustCategoryTotal(work, r.cycle.wakeAt, 10 * 60_000, now, db)
    w = (await db.entries.toArray())[0]
    expect(w.startAt).toBe(iso('2026-10-15 09:20'))
  })

  it('記録がなければ今で終わる記録を作り、0にすれば記録が消える', async () => {
    const work = await cat('仕事')
    const r = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    const now = T('2026-10-15 12:00')
    await adjustCategoryTotal(work, r.cycle.wakeAt, 45 * 60_000, now, db)
    const entries = await db.entries.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].startAt).toBe(iso('2026-10-15 11:15'))
    expect(entries[0].endAt).toBe(iso('2026-10-15 12:00'))
    const r2 = await adjustCategoryTotal(work, r.cycle.wakeAt, 0, now, db)
    expect(await db.entries.count()).toBe(0)
    await r2.undo()
    expect(await db.entries.count()).toBe(1)
  })
})

describe('起床時刻の修正と予算', () => {
  it('古いコピーで起床時刻を直しても、そのサイクルの予算は巻き戻らない', async () => {
    const work = await cat('仕事')
    const r = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    const stale = r.cycle // 画面が持ち続けている古いコピー
    await updateCycleBudgets(stale, { ...stale.budgets, [work.id]: 600 }, db)
    const r2 = await updateWakeAt(stale, iso('2026-10-15 06:30'), db)
    let c = (await db.cycles.get(stale.id))!
    expect(c.wakeAt).toBe(iso('2026-10-15 06:30'))
    expect(c.budgets[work.id]).toBe(600)
    await r2.undo()
    c = (await db.cycles.get(stale.id))!
    expect(c.wakeAt).toBe(iso('2026-10-15 07:00'))
    expect(c.budgets[work.id]).toBe(600)
  })
})

describe('おやすみと繰り越し（§9）', () => {
  it('おやすみで決めた繰り越しが次のサイクルに引き継がれ、リセットで消える', async () => {
    const study = await cat('勉強')
    const r0 = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    const r = await closeDay(r0.cycle, { [study.id]: 40 }, iso('2026-10-15 23:00'), db)
    let c0 = (await db.cycles.get(r0.cycle.id))!
    expect(c0.closedAt).toBe(iso('2026-10-15 23:00'))
    expect(c0.nextCarryover).toEqual({ [study.id]: 40 })
    // 睡眠が動いている
    expect((await db.entries.toArray()).filter((e) => e.endAt === null && e.categoryId === SLEEP_CATEGORY_ID)).toHaveLength(1)

    const r1 = await startCycle({ wakeAt: iso('2026-10-16 06:30') }, db)
    expect(r1.cycle.carryover).toEqual({ [study.id]: 40 })
    const reset = await resetCarryover(r1.cycle, study.id, db)
    expect((await db.cycles.get(r1.cycle.id))!.carryover).toEqual({})
    await reset.undo()
    expect((await db.cycles.get(r1.cycle.id))!.carryover).toEqual({ [study.id]: 40 })

    // おやすみの取り消し
    await r1.undo()
    await r.undo()
    c0 = (await db.cycles.get(r0.cycle.id))!
    expect(c0.closedAt ?? null).toBeNull()
    expect((await db.entries.toArray()).filter((e) => e.categoryId === SLEEP_CATEGORY_ID)).toHaveLength(0)
  })

  it('おやすみを取り消して1日を続けられる（睡眠の計測は残る）', async () => {
    const r0 = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await closeDay(r0.cycle, {}, iso('2026-10-15 23:00'), db)
    await reopenDay(r0.cycle, db)
    expect((await db.cycles.get(r0.cycle.id))!.closedAt).toBeNull()
    expect((await db.entries.toArray()).filter((e) => e.endAt === null)).toHaveLength(1)
  })

  it('睡眠がすでに動いていればおやすみで二重に始めない。長押しなら睡眠と他の同時計測もできる', async () => {
    const sleep = (await db.categories.get(SLEEP_CATEGORY_ID))!
    const work = await cat('仕事')
    const r0 = await startCycle({ wakeAt: iso('2026-10-15 07:00') }, db)
    await startMeasuring(sleep, { at: iso('2026-10-15 22:00') }, db)
    await startMeasuring(work, { at: iso('2026-10-15 22:10'), concurrent: true }, db)
    expect((await db.entries.toArray()).filter((e) => e.endAt === null)).toHaveLength(2)
    await closeDay(r0.cycle, {}, iso('2026-10-15 23:00'), db)
    const running = (await db.entries.toArray()).filter((e) => e.endAt === null)
    expect(running).toHaveLength(1)
    expect(running[0].categoryId).toBe(SLEEP_CATEGORY_ID)
    expect(running[0].startAt).toBe(iso('2026-10-15 22:00'))
  })
})
