import { describe, expect, it } from 'vitest'
import type { Category } from './types'
import { SLEEP_CATEGORY_ID } from './types'
import { buildCarryover, effectiveBudgetMin, proposeCarryover } from './carryover'

const cat = (id: string, mode: Category['mode'], protect = false): Category => ({ id, name: id, color: '#000', order: 0, mode, protect, archived: false, updatedAt: '' })
const categories = [cat('study', 'stopwatch', true), cat('work', 'stopwatch'), cat('fun', 'timer'), cat(SLEEP_CATEGORY_ID, 'sleep')]

describe('繰り越し（§9）', () => {
  it('実効予算は予算＋繰り越し。0未満にはしない', () => {
    expect(effectiveBudgetMin(120, 40)).toBe(160)
    expect(effectiveBudgetMin(120, -30)).toBe(90)
    expect(effectiveBudgetMin(20, -30)).toBe(0)
  })

  it('ストップウォッチ型は不足を、タイマー型は超過を提案し、睡眠は出さない', () => {
    const rows = proposeCarryover(categories, { study: 120, work: 480, fun: 120, sleep: 420 }, undefined, { study: 80, work: 500, fun: 150, sleep: 400 })
    const byId = Object.fromEntries(rows.map((r) => [r.category.id, r]))
    expect(byId.study).toMatchObject({ kind: 'deficit', amountMin: 40, defaultCarry: true })
    expect(byId.work).toMatchObject({ kind: 'none', amountMin: 0 })
    expect(byId.fun).toMatchObject({ kind: 'overage', amountMin: 30, defaultCarry: false })
    expect(byId.sleep).toBeUndefined()
  })

  it('前日の繰り越しを含めた実効予算で不足を数えるので、未達なら合算される', () => {
    const rows = proposeCarryover(categories, { study: 120 }, { study: 40 }, { study: 90 })
    expect(rows[0]).toMatchObject({ effectiveMin: 160, kind: 'deficit', amountMin: 70 })
    const carry = buildCarryover(rows, { study: true })
    expect(carry).toEqual({ study: 70 })
  })

  it('タイマー型の超過を差し引くと負の値になり、リセットを選べば入らない', () => {
    const rows = proposeCarryover(categories, { fun: 120, study: 120 }, undefined, { fun: 150, study: 100 })
    const carry = buildCarryover(rows, { fun: true, study: false })
    expect(carry).toEqual({ fun: -30 })
  })
})
