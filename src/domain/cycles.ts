import type { Category, Cycle, IsoUtc, TimeEntry } from './types'
import { SLEEP_CATEGORY_ID } from './types'
import { localDateKey, toMs } from './time'

/** 起床イベントの並びから求めた、サイクルの期間 */
export interface CycleRange {
  cycle: Cycle
  startMs: number
  /** 次の起床時刻。最後のサイクルは null（進行中） */
  endMs: number | null
}

/** 計測記録をサイクル境界で分割した区間 */
export interface Segment {
  entryId: string
  categoryId: string
  kind: TimeEntry['kind']
  /** 所属サイクル。最初の起床より前の記録は null */
  cycleId: string | null
  startMs: number
  endMs: number
  /** 計測中（終了時刻が null）の記録から作られた区間か */
  running: boolean
}

export function sortCycles(cycles: Cycle[]): Cycle[] {
  return [...cycles].sort((a, b) => toMs(a.wakeAt) - toMs(b.wakeAt))
}

/** 起床時刻の並びから各サイクルの期間を求める（§14.2） */
export function deriveCycleRanges(cycles: Cycle[]): CycleRange[] {
  const sorted = sortCycles(cycles)
  return sorted.map((cycle, i) => ({
    cycle,
    startMs: toMs(cycle.wakeAt),
    endMs: i + 1 < sorted.length ? toMs(sorted[i + 1].wakeAt) : null,
  }))
}

/** 現在進行中のサイクル（最新の起床） */
export function currentCycle(cycles: Cycle[]): Cycle | null {
  const sorted = sortCycles(cycles)
  return sorted.length ? sorted[sorted.length - 1] : null
}

/** ある時刻が属するサイクル */
export function cycleAt(ranges: CycleRange[], ms: number): CycleRange | null {
  for (const r of ranges) {
    if (ms >= r.startMs && (r.endMs === null || ms < r.endMs)) return r
  }
  return null
}

/** 計測記録の実効的な終了時刻（計測中なら現在時刻） */
export function entryEndMs(entry: TimeEntry, nowMs: number): number {
  return entry.endAt === null ? nowMs : toMs(entry.endAt)
}

/**
 * 計測記録をサイクル境界で分割する（§14.2）。
 * - 通常の記録は境界で分割し、それぞれのサイクルに所属させる。
 * - 睡眠の記録は分割せず、開始時刻が属するサイクル（前のサイクル）に全量入れる。
 */
export function splitEntry(entry: TimeEntry, ranges: CycleRange[], nowMs: number): Segment[] {
  const startMs = toMs(entry.startAt)
  const endMs = entryEndMs(entry, nowMs)
  if (endMs <= startMs) return []
  const base = {
    entryId: entry.id,
    categoryId: entry.categoryId,
    kind: entry.kind,
    running: entry.endAt === null,
  }

  if (entry.kind === 'sleep' || entry.categoryId === SLEEP_CATEGORY_ID) {
    const r = cycleAt(ranges, startMs)
    return [{ ...base, cycleId: r ? r.cycle.id : null, startMs, endMs }]
  }

  const segments: Segment[] = []
  // 最初の起床より前の部分
  const first = ranges[0]
  if (!first || startMs < first.startMs) {
    const segEnd = first ? Math.min(endMs, first.startMs) : endMs
    if (segEnd > startMs) segments.push({ ...base, cycleId: null, startMs, endMs: segEnd })
  }
  for (const r of ranges) {
    const s = Math.max(startMs, r.startMs)
    const e = r.endMs === null ? endMs : Math.min(endMs, r.endMs)
    if (e > s) segments.push({ ...base, cycleId: r.cycle.id, startMs: s, endMs: e })
  }
  return segments
}

export function splitEntries(entries: TimeEntry[], ranges: CycleRange[], nowMs: number): Segment[] {
  return entries.flatMap((e) => splitEntry(e, ranges, nowMs))
}

export function segmentsOfCycle(segments: Segment[], cycleId: string | null): Segment[] {
  return segments.filter((s) => s.cycleId === cycleId)
}

/** カテゴリー別合計（ミリ秒）。同時計測の分は重複して数える（§3）。 */
export function categoryTotals(segments: Segment[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const s of segments) {
    totals[s.categoryId] = (totals[s.categoryId] ?? 0) + (s.endMs - s.startMs)
  }
  return totals
}

/** 区間の和集合（重複除外）。開始順に並べ、重なりを結合する。 */
export function mergeIntervals(intervals: { startMs: number; endMs: number }[]): { startMs: number; endMs: number }[] {
  const sorted = intervals
    .filter((i) => i.endMs > i.startMs)
    .map((i) => ({ startMs: i.startMs, endMs: i.endMs }))
    .sort((a, b) => a.startMs - b.startMs)
  const merged: { startMs: number; endMs: number }[] = []
  for (const cur of sorted) {
    const last = merged[merged.length - 1]
    if (last && cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs)
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

/** 計測時間（重複除外、ミリ秒）。同時計測は1回分として数える（§3）。 */
export function measuredUnionMs(segments: Segment[]): number {
  return mergeIntervals(segments).reduce((sum, i) => sum + (i.endMs - i.startMs), 0)
}

/** サイクルの経過時間（ミリ秒）。終わったサイクルは次の起床まで、進行中なら現在まで。 */
export function cycleElapsedMs(range: CycleRange, nowMs: number): number {
  const end = range.endMs ?? nowMs
  return Math.max(0, end - range.startMs)
}

/** 未計測時間（ミリ秒）＝ 経過時間 − 計測時間（重複除外）（§3） */
export function unmeasuredMs(range: CycleRange, segments: Segment[], nowMs: number): number {
  return Math.max(0, cycleElapsedMs(range, nowMs) - measuredUnionMs(segments))
}

/** サイクルの集計結果 */
export interface CycleSummary {
  range: CycleRange
  segments: Segment[]
  elapsedMs: number
  measuredMs: number
  unmeasuredMs: number
  totalsMs: Record<string, number>
}

export function summarizeCycle(range: CycleRange, allSegments: Segment[], nowMs: number): CycleSummary {
  const segments = segmentsOfCycle(allSegments, range.cycle.id)
  const elapsedMs = cycleElapsedMs(range, nowMs)
  const measuredMs = measuredUnionMs(segments)
  return {
    range,
    segments,
    elapsedMs,
    measuredMs,
    unmeasuredMs: Math.max(0, elapsedMs - measuredMs),
    totalsMs: categoryTotals(segments),
  }
}

/**
 * タイムラインバー用に区間を2段に振り分ける（§8.1）。
 * 同時計測で重なった区間は下の段（lane 1）に置く。
 */
export interface LaneSegment extends Segment {
  lane: number
}

export function assignLanes(segments: Segment[], maxLanes = 2): LaneSegment[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const laneEnds: number[] = []
  const out: LaneSegment[] = []
  for (const s of sorted) {
    let lane = laneEnds.findIndex((end) => end <= s.startMs)
    if (lane === -1) {
      if (laneEnds.length < maxLanes) {
        lane = laneEnds.length
        laneEnds.push(s.endMs)
      } else {
        // 空きがないときは一番早く終わる段に重ねて置く
        lane = laneEnds.indexOf(Math.min(...laneEnds))
        laneEnds[lane] = Math.max(laneEnds[lane], s.endMs)
      }
    } else {
      laneEnds[lane] = s.endMs
    }
    out.push({ ...s, lane })
  }
  return out
}

/**
 * サイクルの呼び名（§5.6）。起床した日付。同じ日付に複数あれば ②③… を付ける。
 */
export function cycleLabels(cycles: Cycle[]): Record<string, string> {
  const sorted = sortCycles(cycles)
  const countByDate: Record<string, number> = {}
  for (const c of sorted) {
    const key = localDateKey(c.wakeAt)
    countByDate[key] = (countByDate[key] ?? 0) + 1
  }
  const seen: Record<string, number> = {}
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  const labels: Record<string, string> = {}
  for (const c of sorted) {
    const key = localDateKey(c.wakeAt)
    seen[key] = (seen[key] ?? 0) + 1
    const d = new Date(c.wakeAt)
    const base = `${d.getMonth() + 1}/${d.getDate()}`
    labels[c.id] = countByDate[key] > 1 ? `${base} ${circled[seen[key] - 1] ?? `(${seen[key]})`}` : base
  }
  return labels
}

/** 動いている計測記録 */
export function runningEntries(entries: TimeEntry[]): TimeEntry[] {
  return entries.filter((e) => e.endAt === null)
}

/** あるカテゴリーで動いている計測記録（最大1つ、§6.3） */
export function runningEntryOf(entries: TimeEntry[], categoryId: string): TimeEntry | undefined {
  return entries.find((e) => e.endAt === null && e.categoryId === categoryId)
}

/** 止め忘れの検知（§6.5）。閾値を超えて動いている記録を返す。 */
export function detectForgotten(
  entries: TimeEntry[],
  categories: Category[],
  thresholds: { normalMinutes: number; sleepMinutes: number },
  nowMs: number,
): { entry: TimeEntry; category: Category | undefined; elapsedMs: number }[] {
  const result: { entry: TimeEntry; category: Category | undefined; elapsedMs: number }[] = []
  for (const entry of runningEntries(entries)) {
    const category = categories.find((c) => c.id === entry.categoryId)
    const isSleep = entry.kind === 'sleep' || entry.categoryId === SLEEP_CATEGORY_ID
    const thresholdMs = (isSleep ? thresholds.sleepMinutes : thresholds.normalMinutes) * 60_000
    const elapsedMs = nowMs - toMs(entry.startAt)
    if (elapsedMs >= thresholdMs) result.push({ entry, category, elapsedMs })
  }
  return result
}

/** 予算の合計と未配分（§4.2）。 */
export function budgetSummary(budgets: Record<string, number>, categories: Category[]): {
  totalMinutes: number
  unallocatedMinutes: number
  overMinutes: number
} {
  const active = new Set(categories.filter((c) => !c.archived).map((c) => c.id))
  let total = 0
  for (const [id, min] of Object.entries(budgets)) {
    if (active.has(id)) total += Math.max(0, min || 0)
  }
  return {
    totalMinutes: total,
    unallocatedMinutes: Math.max(0, 1440 - total),
    overMinutes: Math.max(0, total - 1440),
  }
}

export function isoAtOrNull(iso: IsoUtc | null | undefined): number | null {
  return iso ? toMs(iso) : null
}

/** [startMs, endMs) のうち、どの区間にも入っていない「空き」を返す（開始順） */
export function freeGaps(intervals: { startMs: number; endMs: number }[], startMs: number, endMs: number): { startMs: number; endMs: number }[] {
  if (endMs <= startMs) return []
  const busy = mergeIntervals(intervals.map((i) => ({ startMs: Math.max(startMs, i.startMs), endMs: Math.min(endMs, i.endMs) })))
  const gaps: { startMs: number; endMs: number }[] = []
  let cursor = startMs
  for (const b of busy) {
    if (b.startMs > cursor) gaps.push({ startMs: cursor, endMs: b.startMs })
    cursor = Math.max(cursor, b.endMs)
  }
  if (cursor < endMs) gaps.push({ startMs: cursor, endMs })
  return gaps
}
