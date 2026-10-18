import { ProgressBar } from './ProgressBar'
import { usePressable } from '../ui/usePressable'
import { formatMinutes, formatMsWithSeconds, msToMinutes } from '../domain/time'
import type { Category } from '../domain/types'
import { effectiveBudgetMin } from '../domain/carryover'

/**
 * アクションカード（§7.3）。
 * 広い領域全体がタップ領域。タップで開始／停止、長押しで同時計測。
 * 右端の［⋯］は独立したボタンで、押しても計測は切り替わらない。
 */
export function ActionCard({
  category,
  measuredMs,
  budgetMin,
  carryMin = 0,
  running,
  onTap,
  onLongPress,
  onMenu,
}: {
  category: Category
  /** このサイクルのカテゴリー別合計（ミリ秒） */
  measuredMs: number
  budgetMin: number
  /** 前日からの繰り越し（分、符号付き）。予算とは別に「2:00 +0:40」と併記する（§9） */
  carryMin?: number
  running: boolean
  onTap: () => void
  onLongPress?: () => void
  onMenu: () => void
}) {
  const { pressing, longPressing, handlers } = usePressable({ onTap, onLongPress })
  const measuredMin = msToMinutes(measuredMs)
  const effectiveMin = effectiveBudgetMin(budgetMin, carryMin)
  const status = describe(category, measuredMin, effectiveMin)
  const className = ['card', running ? 'card-running' : '', pressing ? 'card-pressing' : '', longPressing ? 'card-longpress' : ''].filter(Boolean).join(' ')

  return (
    <div className={className} style={{ ['--cat' as string]: category.color }}>
      <div className="card-tap" {...handlers} role="button" tabIndex={0} aria-pressed={running} aria-label={`${category.name} ${running ? '停止' : '開始'}`}>
        <div className="card-row">
          <span className="card-name">
            <span className="card-dot" />
            {category.name}
            {category.protect && <span className="card-protect" title="優先して守る">★</span>}
          </span>
          <span className="card-numbers">
            {/* 秒まで出して、計測中は動いていることが見えるようにする（停止中も表記をそろえる） */}
            <span className={`card-measured ${running ? 'ticking' : ''}`}>{formatMsWithSeconds(measuredMs)}</span>
            <span className="card-budget">
              {' / '}
              {budgetMin > 0 || carryMin !== 0 ? formatMinutes(budgetMin) : '—'}
              {carryMin !== 0 && <span className={`card-carry ${carryMin > 0 ? 'plus' : 'minus'}`}> {carryMin > 0 ? '+' : '−'}{formatMinutes(Math.abs(carryMin))}</span>}
            </span>
          </span>
        </div>
        <div className="card-row card-row-sub">
          <span className={`card-status ${status.tone}`}>{status.text}</span>
          <span className={`card-state ${running ? 'on' : ''}`}>
            {running ? (
              <>
                <span className="pulse-dot" aria-hidden="true">●</span> 計測中<span className="dots" aria-hidden="true" />
              </>
            ) : (
              '停止中'
            )}
          </span>
        </div>
        <ProgressBar mode={category.mode} measuredMin={measuredMin} budgetMin={effectiveMin} color={category.color} />
        {longPressing && <div className="card-hint">同時計測で開始</div>}
      </div>
      <button type="button" className="card-menu" onClick={onMenu} aria-label={`${category.name}のメニュー`}>
        ⋯
      </button>
    </div>
  )
}

function describe(category: Category, measured: number, budget: number): { text: string; tone: string } {
  if (budget <= 0) return { text: '枠なし', tone: 'muted' }
  if (category.mode === 'timer') {
    const remaining = budget - measured
    if (remaining > 0) return { text: `残り ${formatMinutes(remaining)}`, tone: 'muted' }
    if (remaining === 0) return { text: '枠どおり', tone: 'muted' }
    return { text: `超過 ${formatMinutes(-remaining)}`, tone: 'neutral' }
  }
  if (category.mode === 'sleep') {
    const diff = measured - budget
    if (diff === 0) return { text: '枠どおり', tone: 'muted' }
    return diff > 0 ? { text: `枠より ${formatMinutes(diff)} 多い`, tone: 'muted' } : { text: `枠まで ${formatMinutes(-diff)}`, tone: 'muted' }
  }
  const over = measured - budget
  if (over >= 0) return { text: over === 0 ? '目標到達' : `目標到達 +${formatMinutes(over)}`, tone: 'positive' }
  // 目標に届くまでは数字（計測済み / 予算）だけを見せる。催促になる文言は出さない（§1）
  return { text: '', tone: 'muted' }
}
