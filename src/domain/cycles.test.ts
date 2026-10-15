import { describe, it, expect } from 'vitest'
import type { Category, Cycle, TimeEntry } from './types'
import { SLEEP_CATEGORY_ID } from './types'
import {
  assignLanes,
  budgetSummary,
  categoryTotals,
  cycleLabels,
  deriveCycleRanges,
  detectForgotten,
  measuredUnionMs,
  mergeIntervals,
  splitEntries,
  splitEntry,
  summarizeCycle,
  unmeasuredMs,
} from './cycles'
import { HOUR, toIso, toMs } from './time'

// 日本時間 2026-10-15 07:00 = UTC 2026-10-14T22:00Z
const T = (jst: string) => toMs(`${jst}+09:00`)
const iso = (jst: string) => toIso(T(jst))

const cycle = (id: string, wakeJst: string): Cycle => ({
  id,
  wakeAt: iso(wakeJst),
  budgets: {},
  manualCut: false,
  updatedAt: iso(wakeJst),
})

const entry = (id: string, categoryId: string, startJst: string, endJst: string | null, kind: TimeEntry['kind'] = 'manual'): TimeEntry => ({
  id,
  categoryId,
  startAt: iso(startJst),
  endAt: endJst ? iso(endJst) : null,
  kind,
  updatedAt: iso(startJst),
})

describe('サイクルの導出', () => {
  it('起床時刻の並びから期間を求め、最後は進行中（終了なし）', () => {
    const ranges = deriveCycleRanges([cycle('b', '2026-10-16 06:30'), cycle('a', '2026-10-15 07:00')])
    expect(ranges.map((r) => r.cycle.id)).toEqual(['a', 'b'])
    expect(ranges[0].endMs).toBe(T('2026-10-16 06:30'))
    expect(ranges[1].endMs).toBeNull()
  })
})

describe('計測記録の分割（§14.2）', () => {
  const ranges = deriveCycleRanges([cycle('d1', '2026-10-15 07:00'), cycle('d2', '2026-10-16 06:30')])
  const now = T('2026-10-16 12:00')

  it('境界をまたぐ記録は境界で2つに分かれ、それぞれのサイクルに所属する', () => {
    const segs = splitEntry(entry('e1', 'work', '2026-10-16 05:00', '2026-10-16 08:00'), ranges, now)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ cycleId: 'd1', startMs: T('2026-10-16 05:00'), endMs: T('2026-10-16 06:30') })
    expect(segs[1]).toMatchObject({ cycleId: 'd2', startMs: T('2026-10-16 06:30'), endMs: T('2026-10-16 08:00') })
  })

  it('午前0時をまたいでも同じサイクルに留まる（§17-3）', () => {
    const segs = splitEntry(entry('e1', 'work', '2026-10-15 23:00', '2026-10-16 01:00'), ranges, now)
    expect(segs).toHaveLength(1)
    expect(segs[0].cycleId).toBe('d1')
  })

  it('睡眠は分割せず、寝る前に始まっていたサイクルに全量入る（§5.3）', () => {
    const segs = splitEntry(entry('s1', SLEEP_CATEGORY_ID, '2026-10-15 23:30', '2026-10-16 06:30', 'sleep'), ranges, now)
    expect(segs).toHaveLength(1)
    expect(segs[0].cycleId).toBe('d1')
    expect(segs[0].endMs - segs[0].startMs).toBe(7 * HOUR)
  })

  it('睡眠が起床時刻を少し超えていても分割されず前のサイクルに入る', () => {
    const segs = splitEntry(entry('s1', SLEEP_CATEGORY_ID, '2026-10-15 23:30', '2026-10-16 06:40', 'sleep'), ranges, now)
    expect(segs).toHaveLength(1)
    expect(segs[0].cycleId).toBe('d1')
  })

  it('計測中の記録は現在時刻までとして扱う（§6.8）', () => {
    const segs = splitEntry(entry('e1', 'study', '2026-10-16 10:00', null), ranges, now)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ cycleId: 'd2', endMs: now, running: true })
  })

  it('最初の起床より前の記録はどのサイクルにも属さない', () => {
    const segs = splitEntry(entry('e1', 'work', '2026-10-15 05:00', '2026-10-15 08:00'), ranges, now)
    expect(segs).toHaveLength(2)
    expect(segs[0].cycleId).toBeNull()
    expect(segs[1].cycleId).toBe('d1')
  })

  it('起床時刻を修正すると、境界をまたぐ記録の所属が変わる（§17-13）', () => {
    const e = entry('e1', 'work', '2026-10-16 05:00', '2026-10-16 08:00')
    const before = splitEntry(e, ranges, now)
    expect(before.map((s) => [s.cycleId, s.endMs - s.startMs])).toEqual([
      ['d1', 1.5 * HOUR],
      ['d2', 1.5 * HOUR],
    ])
    // 起床を 04:30 に修正 → 記録は全量 d2 へ
    const edited = deriveCycleRanges([cycle('d1', '2026-10-15 07:00'), cycle('d2', '2026-10-16 04:30')])
    const after = splitEntry(e, edited, now)
    expect(after).toHaveLength(1)
    expect(after[0].cycleId).toBe('d2')
    expect(after[0].endMs - after[0].startMs).toBe(3 * HOUR)
  })
})

describe('集計（§3）', () => {
  const ranges = deriveCycleRanges([cycle('d1', '2026-10-15 07:00')])
  const now = T('2026-10-15 12:00')

  it('カテゴリー別合計は同時計測の分だけ重複し、計測時間（重複除外）は重複しない（§17-12）', () => {
    const entries = [
      entry('e1', 'work', '2026-10-15 08:00', '2026-10-15 10:00'),
      entry('e2', 'study', '2026-10-15 09:00', '2026-10-15 11:00'),
    ]
    const segs = splitEntries(entries, ranges, now)
    const totals = categoryTotals(segs)
    expect(totals.work).toBe(2 * HOUR)
    expect(totals.study).toBe(2 * HOUR)
    expect(measuredUnionMs(segs)).toBe(3 * HOUR)
    expect(unmeasuredMs(ranges[0], segs, now)).toBe(2 * HOUR) // 5時間経過 − 3時間
  })

  it('summarizeCycle は該当サイクルの区間だけを集計する', () => {
    const r = deriveCycleRanges([cycle('d1', '2026-10-15 07:00'), cycle('d2', '2026-10-16 06:30')])
    const entries = [
      entry('e1', 'work', '2026-10-16 05:00', '2026-10-16 08:00'),
      entry('s1', SLEEP_CATEGORY_ID, '2026-10-15 23:00', '2026-10-16 06:30', 'sleep'),
    ]
    const nowMs = T('2026-10-16 09:00')
    const segs = splitEntries(entries, r, nowMs)
    const d1 = summarizeCycle(r[0], segs, nowMs)
    const d2 = summarizeCycle(r[1], segs, nowMs)
    expect(d1.elapsedMs).toBe(23.5 * HOUR)
    expect(d1.totalsMs[SLEEP_CATEGORY_ID]).toBe(7.5 * HOUR)
    expect(d1.totalsMs.work).toBe(1.5 * HOUR)
    // 睡眠 23:00-06:30 と仕事 05:00-06:30 は重なるので、重複除外では 7.5 時間
    expect(d1.measuredMs).toBe(7.5 * HOUR)
    expect(d2.elapsedMs).toBe(2.5 * HOUR)
    expect(d2.totalsMs.work).toBe(1.5 * HOUR)
    expect(d2.unmeasuredMs).toBe(1 * HOUR)
  })

  it('サイクルが24時間を超えても切り詰めない（§5.2）', () => {
    const r = deriveCycleRanges([cycle('d1', '2026-10-15 07:00')])
    const nowMs = T('2026-10-16 09:00')
    const s = summarizeCycle(r[0], [], nowMs)
    expect(s.elapsedMs).toBe(26 * HOUR)
  })

  it('mergeIntervals は重なりと接する区間を結合する', () => {
    const merged = mergeIntervals([
      { startMs: 0, endMs: 10 },
      { startMs: 5, endMs: 20 },
      { startMs: 20, endMs: 30 },
      { startMs: 40, endMs: 50 },
    ])
    expect(merged).toEqual([
      { startMs: 0, endMs: 30 },
      { startMs: 40, endMs: 50 },
    ])
  })
})

describe('タイムラインバーの段分け（§8.1）', () => {
  it('重なる区間は2段目に置き、重ならない区間は1段目に戻る', () => {
    const segs = splitEntries(
      [
        entry('e1', 'work', '2026-10-15 08:00', '2026-10-15 10:00'),
        entry('e2', 'study', '2026-10-15 09:00', '2026-10-15 11:00'),
        entry('e3', 'run', '2026-10-15 11:00', '2026-10-15 12:00'),
      ],
      deriveCycleRanges([cycle('d1', '2026-10-15 07:00')]),
      T('2026-10-15 13:00'),
    )
    const lanes = assignLanes(segs)
    expect(lanes.find((l) => l.entryId === 'e1')!.lane).toBe(0)
    expect(lanes.find((l) => l.entryId === 'e2')!.lane).toBe(1)
    expect(lanes.find((l) => l.entryId === 'e3')!.lane).toBe(0)
  })
})

describe('サイクルの呼び名（§5.6）', () => {
  it('同じ日付に2つあれば番号を付ける', () => {
    const labels = cycleLabels([
      cycle('a', '2026-10-15 07:00'),
      cycle('b', '2026-10-15 20:00'),
      cycle('c', '2026-10-16 07:00'),
    ])
    expect(labels.a).toBe('10/15 ①')
    expect(labels.b).toBe('10/15 ②')
    expect(labels.c).toBe('10/16')
  })
})

describe('止め忘れの検知（§6.5）', () => {
  const categories: Category[] = [
    { id: 'study', name: '勉強', color: '#000', order: 0, mode: 'stopwatch', protect: false, archived: false, updatedAt: iso('2026-10-15 07:00') },
    { id: SLEEP_CATEGORY_ID, name: '睡眠', color: '#000', order: 99, mode: 'sleep', protect: false, archived: false, updatedAt: iso('2026-10-15 07:00') },
  ]
  const thresholds = { normalMinutes: 240, sleepMinutes: 840 }

  it('4時間以上動いている計測を検知する', () => {
    const entries = [entry('e1', 'study', '2026-10-15 08:00', null)]
    expect(detectForgotten(entries, categories, thresholds, T('2026-10-15 11:59'))).toHaveLength(0)
    const hit = detectForgotten(entries, categories, thresholds, T('2026-10-15 12:00'))
    expect(hit).toHaveLength(1)
    expect(hit[0].elapsedMs).toBe(4 * HOUR)
  })

  it('睡眠は14時間が閾値', () => {
    const entries = [entry('s1', SLEEP_CATEGORY_ID, '2026-10-15 23:00', null, 'sleep')]
    expect(detectForgotten(entries, categories, thresholds, T('2026-10-16 12:00'))).toHaveLength(0)
    expect(detectForgotten(entries, categories, thresholds, T('2026-10-16 13:00'))).toHaveLength(1)
  })

  it('停止済みの記録は対象外', () => {
    const entries = [entry('e1', 'study', '2026-10-15 00:00', '2026-10-15 10:00')]
    expect(detectForgotten(entries, categories, thresholds, T('2026-10-15 23:00'))).toHaveLength(0)
  })
})

describe('予算の集計（§4.2）', () => {
  const categories: Category[] = [
    { id: 'work', name: '仕事', color: '#000', order: 0, mode: 'stopwatch', protect: false, archived: false, updatedAt: '' },
    { id: 'old', name: '古い', color: '#000', order: 1, mode: 'stopwatch', protect: false, archived: true, updatedAt: '' },
    { id: SLEEP_CATEGORY_ID, name: '睡眠', color: '#000', order: 99, mode: 'sleep', protect: false, archived: false, updatedAt: '' },
  ]
  it('未配分を表示し、アーカイブ済みは数えない', () => {
    const s = budgetSummary({ work: 480, sleep: 420, old: 999 }, categories)
    expect(s.totalMinutes).toBe(900)
    expect(s.unallocatedMinutes).toBe(540)
    expect(s.overMinutes).toBe(0)
  })
  it('24時間を超えた分を返す', () => {
    const s = budgetSummary({ work: 1000, sleep: 500 }, categories)
    expect(s.totalMinutes).toBe(1500)
    expect(s.unallocatedMinutes).toBe(0)
    expect(s.overMinutes).toBe(60)
  })
  it('1分単位の端数でも合計が正しい', () => {
    const s = budgetSummary({ work: 1439, sleep: 1 }, categories)
    expect(s.totalMinutes).toBe(1440)
  })
})
