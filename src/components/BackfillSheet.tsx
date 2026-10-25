import { useState } from 'react'
import { Sheet } from '../ui/Modal'
import { MinutesField } from '../ui/DateTimeField'
import { formatClock, formatMinutes } from '../domain/time'
import type { Category } from '../domain/types'

/**
 * 未計測の時間をタイマーごとに振り分けて記録する。
 * 起床から今までの空き時間に、上から順に並べて入れる（互いに重ならない）。
 */
export function BackfillSheet({
  categories,
  freeMin,
  wakeAt,
  title = '未計測の時間を振り分ける',
  primaryLabel = '記録する',
  secondaryLabel,
  onSubmit,
  onSecondary,
  onClose,
}: {
  categories: Category[]
  /** 起床から今までの空き時間（分） */
  freeMin: number
  wakeAt: string
  title?: string
  primaryLabel?: string
  /** 「記録せずに区切る」のような、振り分けずに進むボタン */
  secondaryLabel?: string
  onSubmit: (allocations: { category: Category; minutes: number }[], moveWakeEarlier: boolean) => void
  onSecondary?: () => void
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, number>>({})
  const total = Object.values(values).reduce((s, v) => s + (v || 0), 0)
  const over = Math.max(0, total - freeMin)
  const allocations = categories.map((c) => ({ category: c, minutes: values[c.id] ?? 0 })).filter((a) => a.minutes > 0)

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted small">
        起床（{formatClock(wakeAt)}）から今までの空き時間は {formatMinutes(freeMin)} です。何にどれだけ使ったかを入れると、起床に近いほうから順に記録します。
      </p>
      <ul className="backfill-list">
        {categories.map((c) => (
          <li key={c.id} className="backfill-row">
            <span className="backfill-name">
              <span className="card-dot" style={{ background: c.color }} />
              {c.name}
            </span>
            <MinutesField value={values[c.id] ?? 0} onChange={(m) => setValues({ ...values, [c.id]: m })} step={10} />
          </li>
        ))}
      </ul>
      <p className="muted small">
        振り分け {formatMinutes(total)} / 空き {formatMinutes(freeMin)}
        {total > 0 && total < freeMin && `（残り ${formatMinutes(freeMin - total)} は未計測のまま）`}
      </p>
      {over > 0 && (
        <p className="notice">
          空き時間より {formatMinutes(over)} 多いので、保存すると起床時刻をその分だけ早めて（{formatClock(new Date(new Date(wakeAt).getTime() - over * 60_000).toISOString())}）入れます。
        </p>
      )}
      <div className="sheet-actions">
        {secondaryLabel && onSecondary && (
          <button type="button" className="btn btn-quiet" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(allocations, over > 0)} disabled={allocations.length === 0}>
          {over > 0 ? '起床を早めて' + primaryLabel : primaryLabel}
        </button>
      </div>
    </Sheet>
  )
}
