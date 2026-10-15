import { ProgressBar } from './ProgressBar'
import { usePressable } from '../ui/usePressable'
import { formatMinutes } from '../domain/time'
import type { Category } from '../domain/types'

/**
 * アクションカード（§7.3）。
 * 広い領域全体がタップ領域。タップで開始／停止、長押しで同時計測。
 * 右端の［⋯］は独立したボタンで、押しても計測は切り替わらない。
 */
export function ActionCard({
  category,
  measuredMin,
  budgetMin,
  running,
  onTap,
  onLongPress,
  onMenu,
}: {
  category: Category
  measuredMin: number
  budgetMin: number
  running: boolean
  onTap: () => void
  onLongPress?: () => void
  onMenu: () => void
}) {
  const { pressing, longPressing, handlers } = usePressable({ onTap, onLongPress })
  const status = describe(category, measuredMin, budgetMin)
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
            <span className="card-measured">{formatMinutes(measuredMin)}</span>
            <span className="card-budget"> / {budgetMin > 0 ? formatMinutes(budgetMin) : '—'}</span>
          </span>
        </div>
        <div className="card-row card-row-sub">
          <span className={`card-status ${status.tone}`}>{status.text}</span>
          <span className={`card-state ${running ? 'on' : ''}`}>{running ? '● 計測中' : '停止中'}</span>
        </div>
        <ProgressBar mode={category.mode} measuredMin={measuredMin} budgetMin={budgetMin} color={category.color} />
        {longPressing && <div className="card-hint">同時計測で開始</div>}
      </div>
      <button type="button" className="card-menu" onClick={onMenu} aria-label={`${category.name}のメニュー`}>
        ⋯
      </button>
    </div>
  )
}

function describe(category: Category, measured: number, budget: number): { text: string; tone: string } {
  if (budget <= 0) return { text: '予算なし', tone: 'muted' }
  if (category.mode === 'timer') {
    const remaining = budget - measured
    if (remaining > 0) return { text: `残り ${formatMinutes(remaining)}`, tone: 'muted' }
    if (remaining === 0) return { text: '予算どおり', tone: 'muted' }
    return { text: `超過 ${formatMinutes(-remaining)}`, tone: 'neutral' }
  }
  if (category.mode === 'sleep') {
    const diff = measured - budget
    if (diff === 0) return { text: '予算どおり', tone: 'muted' }
    return diff > 0 ? { text: `予算より ${formatMinutes(diff)} 多い`, tone: 'muted' } : { text: `予算まで ${formatMinutes(-diff)}`, tone: 'muted' }
  }
  const over = measured - budget
  if (over >= 0) return { text: over === 0 ? '目標到達' : `目標到達 +${formatMinutes(over)}`, tone: 'positive' }
  // 目標に届くまでは数字（計測済み / 予算）だけを見せる。催促になる文言は出さない（§1）
  return { text: '', tone: 'muted' }
}
