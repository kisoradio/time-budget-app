import type { MeasureMode } from '../domain/types'

/**
 * カード内の進捗バー（§8.2）。
 * - ストップウォッチ型：予算を全長とし、計測済みを塗る。到達後は別色で超過分を延長。
 * - タイマー型：残りが減っていくように見せる（塗りが右から減る）。
 * - 睡眠：予算に対する実績を塗るだけ。
 */
export function ProgressBar({ mode, measuredMin, budgetMin, color }: { mode: MeasureMode; measuredMin: number; budgetMin: number; color: string }) {
  const budget = Math.max(0, budgetMin)
  const measured = Math.max(0, measuredMin)
  if (budget === 0) {
    // 予算なし：計測があれば全体を薄く塗る
    return (
      <div className="progress" aria-hidden="true">
        {measured > 0 && <div className="progress-fill" style={{ width: '100%', background: color, opacity: 0.35 }} />}
      </div>
    )
  }
  if (mode === 'timer') {
    const remaining = Math.max(0, budget - measured)
    const over = Math.max(0, measured - budget)
    const total = budget + over
    return (
      <div className="progress" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${(remaining / total) * 100}%`, background: color }} />
        {over > 0 && <div className="progress-over neutral" style={{ width: `${(over / total) * 100}%` }} />}
      </div>
    )
  }
  const over = Math.max(0, measured - budget)
  const total = budget + over
  return (
    <div className="progress" aria-hidden="true">
      <div className="progress-fill" style={{ width: `${(Math.min(measured, budget) / total) * 100}%`, background: color }} />
      {over > 0 && <div className="progress-over positive" style={{ width: `${(over / total) * 100}%` }} />}
    </div>
  )
}
