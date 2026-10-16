import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { buildCarryover, type CarryRow } from '../domain/carryover'
import { formatMinutes } from '../domain/time'
import type { BudgetMap } from '../domain/types'

/**
 * 「おやすみ」で出す今日のまとめ（§9）。
 * カテゴリーごとに、不足分を繰り越すか／超過分を差し引くかを選ぶ。
 */
export function CloseDaySheet({
  rows,
  title = '今日のまとめ',
  primaryLabel = 'おやすみ',
  onSubmit,
  onClose,
}: {
  rows: CarryRow[]
  title?: string
  primaryLabel?: string
  onSubmit: (nextCarryover: BudgetMap) => void
  onClose: () => void
}) {
  const [choices, setChoices] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.category.id, r.defaultCarry])))
  const choosable = rows.filter((r) => r.kind !== 'none')
  const others = rows.filter((r) => r.kind === 'none')

  return (
    <Sheet title={title} onClose={onClose}>
      {choosable.length === 0 && <p className="muted small">繰り越す不足も、差し引く超過もありません。</p>}
      <ul className="carry-list">
        {choosable.map((r) => {
          const on = !!choices[r.category.id]
          return (
            <li key={r.category.id} className="carry-row">
              <div className="carry-head">
                <span className="carry-name">
                  <span className="card-dot" style={{ background: r.category.color }} />
                  {r.category.name}
                </span>
                <span className="muted small">
                  {formatMinutes(r.measuredMin)} / {formatMinutes(r.effectiveMin)}
                </span>
              </div>
              <div className="carry-body">
                <span className={r.kind === 'deficit' ? 'muted' : 'neutral'}>
                  {r.kind === 'deficit' ? `${formatMinutes(r.amountMin)} 不足` : `${formatMinutes(r.amountMin)} 超過`}
                </span>
                <div className="segmented small">
                  <button type="button" className={on ? 'selected' : ''} onClick={() => setChoices({ ...choices, [r.category.id]: true })}>
                    {r.kind === 'deficit' ? '翌日に繰り越す' : '翌日から差し引く'}
                  </button>
                  <button type="button" className={!on ? 'selected' : ''} onClick={() => setChoices({ ...choices, [r.category.id]: false })}>
                    リセット
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {others.length > 0 && (
        <p className="muted small">
          {others.map((r) => `${r.category.name} ${formatMinutes(r.measuredMin)} / ${formatMinutes(r.effectiveMin)}`).join('・')}
        </p>
      )}
      <div className="sheet-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(buildCarryover(rows, choices))}>
          {primaryLabel}
        </button>
      </div>
    </Sheet>
  )
}
