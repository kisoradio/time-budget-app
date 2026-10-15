import { formatMinutes } from '../domain/time'
import { DAY_MINUTES, type Category } from '../domain/types'

/** 配分のドーナツグラフ（§8.3）。タップしたカテゴリーを知らせる。 */
export function Donut({
  budgets,
  categories,
  selectedId,
  onSelect,
}: {
  budgets: Record<string, number>
  categories: Category[]
  selectedId?: string | null
  onSelect?: (categoryId: string) => void
}) {
  const size = 240
  const c = size / 2
  const r = 92
  const stroke = 34
  const circ = 2 * Math.PI * r
  const items = categories.map((cat) => ({ cat, min: Math.max(0, budgets[cat.id] ?? 0) })).filter((i) => i.min > 0)
  const total = items.reduce((s, i) => s + i.min, 0)
  const denom = Math.max(DAY_MINUTES, total)
  let offset = 0
  const arcs = items.map((i) => {
    const frac = i.min / denom
    const arc = { ...i, dash: frac * circ, offset }
    offset += frac * circ
    return arc
  })
  const unallocated = Math.max(0, DAY_MINUTES - total)
  const over = Math.max(0, total - DAY_MINUTES)

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="donut" role="img" aria-label="予算の配分">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bar-empty)" strokeWidth={stroke} />
      {arcs.map((a) => (
        <circle
          key={a.cat.id}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={a.cat.color}
          strokeWidth={selectedId === a.cat.id ? stroke + 8 : stroke}
          strokeDasharray={`${a.dash} ${circ - a.dash}`}
          strokeDashoffset={-a.offset}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
          onClick={() => onSelect?.(a.cat.id)}
        />
      ))}
      <text x={c} y={c - 6} textAnchor="middle" className="donut-total">
        {formatMinutes(total)}
      </text>
      <text x={c} y={c + 18} textAnchor="middle" className="donut-sub">
        {over > 0 ? `24時間を ${formatMinutes(over)} 超過` : `未配分 ${formatMinutes(unallocated)}`}
      </text>
    </svg>
  )
}
