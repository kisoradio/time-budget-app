import { formatMinutes, fromDatetimeLocalValue, toDatetimeLocalValue } from '../domain/time'

/** 端末のタイムゾーンで日時を入力し、UTC の ISO 文字列でやり取りする */
export function DateTimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label?: string
  value: string | null
  onChange: (iso: string | null) => void
  disabled?: boolean
}) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input
        type="datetime-local"
        value={value ? toDatetimeLocalValue(value) : ''}
        disabled={disabled}
        onChange={(e) => onChange(fromDatetimeLocalValue(e.target.value))}
      />
    </label>
  )
}

/**
 * 分数をスライダーで編集する（10分刻み）。
 * 数字を打ち込まずに、指でなぞるか −10／＋10 で合わせる。
 */
export function MinutesField({
  label,
  value,
  onChange,
  max = 16 * 60,
  step = 10,
}: {
  label?: string
  value: number
  onChange: (minutes: number) => void
  /** スライダーの右端（分）。既定は16時間 */
  max?: number
  step?: number
}) {
  const v = Math.max(0, Math.min(max, Math.round(value / step) * step))
  const set = (n: number) => onChange(Math.max(0, Math.min(max, n)))
  return (
    <div className="field minutes-field">
      <div className="minutes-head">
        {label && <span className="field-label">{label}</span>}
        <span className="minutes-value">{formatMinutes(v)}</span>
      </div>
      <div className="minutes-slider">
        <button type="button" className="step-btn" onClick={() => set(v - step)} disabled={v <= 0} aria-label={`${step}分減らす`}>
          −
        </button>
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={v}
          onChange={(e) => set(parseInt(e.target.value, 10))}
          aria-label={label ?? '時間'}
          aria-valuetext={formatMinutes(v)}
          style={{ ['--pct' as string]: `${(v / max) * 100}%` }}
        />
        <button type="button" className="step-btn" onClick={() => set(v + step)} disabled={v >= max} aria-label={`${step}分増やす`}>
          ＋
        </button>
      </div>
    </div>
  )
}
