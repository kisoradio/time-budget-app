import type { BudgetMap, Category } from './types'
import { SLEEP_CATEGORY_ID } from './types'

/** 予算に繰り越しを足した「今日の実効予算」（分）。0 未満にはしない。 */
export function effectiveBudgetMin(budgetMin: number, carryMin: number | undefined): number {
  return Math.max(0, (budgetMin || 0) + (carryMin || 0))
}

export type CarryKind = 'deficit' | 'overage' | 'none'

export interface CarryRow {
  category: Category
  budgetMin: number
  carryMin: number
  effectiveMin: number
  measuredMin: number
  /** deficit: 不足（ストップウォッチ型）、overage: 超過（タイマー型）、none: 選択なし */
  kind: CarryKind
  /** 不足または超過の分数（正の値） */
  amountMin: number
  /** 「繰り越す／差し引く」の初期値（§9：優先して守るがオンなら繰り越す） */
  defaultCarry: boolean
}

/**
 * 「おやすみ」で出す今日のまとめ（§9）。
 * - ストップウォッチ型：不足分を翌日に繰り越すか選ぶ。超過は良いことなので翌日に影響しない。
 * - タイマー型：超過分を翌日の予算から差し引くか選ぶ。
 * - 睡眠は対象外。
 */
export function proposeCarryover(categories: Category[], budgets: BudgetMap, carryover: BudgetMap | undefined, totalsMin: Record<string, number>): CarryRow[] {
  const rows: CarryRow[] = []
  for (const c of categories) {
    if (c.archived || c.id === SLEEP_CATEGORY_ID || c.mode === 'sleep') continue
    const budgetMin = budgets[c.id] ?? 0
    const carryMin = carryover?.[c.id] ?? 0
    const effectiveMin = effectiveBudgetMin(budgetMin, carryMin)
    if (effectiveMin <= 0 && carryMin === 0) continue
    const measuredMin = totalsMin[c.id] ?? 0
    const diff = measuredMin - effectiveMin
    let kind: CarryKind = 'none'
    let amountMin = 0
    if (c.mode === 'stopwatch' && diff < 0) {
      kind = 'deficit'
      amountMin = -diff
    } else if (c.mode === 'timer' && diff > 0) {
      kind = 'overage'
      amountMin = diff
    }
    rows.push({ category: c, budgetMin, carryMin, effectiveMin, measuredMin, kind, amountMin, defaultCarry: kind !== 'none' && c.protect })
  }
  return rows
}

/** 選択結果から、次のサイクルの繰り越し（分、符号付き）を作る */
export function buildCarryover(rows: CarryRow[], choices: Record<string, boolean>): BudgetMap {
  const out: BudgetMap = {}
  for (const r of rows) {
    if (r.kind === 'none' || !choices[r.category.id]) continue
    out[r.category.id] = r.kind === 'deficit' ? r.amountMin : -r.amountMin
  }
  return out
}

/** 繰り越しが1つでもあるか */
export function hasCarryover(carry: BudgetMap | undefined): boolean {
  return !!carry && Object.values(carry).some((v) => v !== 0)
}
