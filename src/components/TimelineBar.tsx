import { assignLanes, measuredUnionMs, type CycleRange, type Segment } from '../domain/cycles'
import { HOUR, formatMs } from '../domain/time'
import type { Category } from '../domain/types'

/**
 * 24時間タイムラインバー（§8.1）。
 * 左端が起床、右端が起床＋24時間。計測記録を実際の時刻の位置に色で描く。
 * 同時計測は上下2段。現在時刻に細い線。24時間を超えた分は詰めて表示する。
 */
export function TimelineBar({
  range,
  segments,
  categories,
  nowMs,
  onTap,
}: {
  range: CycleRange
  segments: Segment[]
  categories: Category[]
  nowMs: number
  onTap?: () => void
}) {
  const W = 1000
  const H = 44
  const laneH = H / 2
  const start = range.startMs
  const elapsed = Math.max(0, (range.endMs ?? nowMs) - start)
  const span = Math.max(24 * HOUR, elapsed)
  const x = (ms: number) => Math.max(0, Math.min(W, ((ms - start) / span) * W))
  const colorOf = (id: string) => categories.find((c) => c.id === id)?.color ?? '#999'
  const lanes = assignLanes(segments)
  const hasSecondLane = lanes.some((l) => l.lane === 1)
  const nowX = range.endMs === null ? x(nowMs) : null
  const over24 = elapsed > 24 * HOUR

  return (
    <div className="timeline" onClick={onTap} role={onTap ? 'button' : undefined} aria-label="24時間タイムライン">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="timeline-svg">
        <rect x={0} y={0} width={W} height={H} rx={6} fill="var(--bar-empty)" />
        {/* 経過した範囲を少し濃いグレーに（未計測） */}
        <rect x={0} y={0} width={x(start + elapsed)} height={H} fill="var(--bar-elapsed)" />
        {lanes.map((s, i) => {
          const x1 = x(s.startMs)
          const x2 = x(s.endMs)
          if (x2 - x1 < 0.5) return null
          const y = hasSecondLane ? s.lane * laneH : 0
          const h = hasSecondLane ? laneH : H
          return <rect key={`${s.entryId}-${i}`} x={x1} y={y} width={x2 - x1} height={h} fill={colorOf(s.categoryId)} opacity={s.running ? 0.85 : 1} />
        })}
        {/* 6時間ごとの目盛り */}
        {[6, 12, 18].map((hr) => {
          const xx = ((hr * HOUR) / span) * W
          return <line key={hr} x1={xx} x2={xx} y1={0} y2={H} stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />
        })}
        {nowX !== null && <line x1={nowX} x2={nowX} y1={-2} y2={H + 2} stroke="var(--ink)" strokeWidth={3} />}
      </svg>
      <div className="timeline-caption">
        <span>起床から {formatMs(elapsed)}{over24 ? '（24時間超）' : ''}</span>
        <span>計測 {formatMs(measuredUnionMs(segments))}</span>
      </div>
    </div>
  )
}
