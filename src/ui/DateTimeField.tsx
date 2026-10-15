import { useState } from 'react'
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
 * 分数をスライダーで編集する（既定 30 分刻み、右端 10 時間）。
 * 細かい値や 10 時間超は、上の数字をタップして「時間」「分」を手入力する。
 */
export function MinutesField({
  label,
  value,
  onChange,
  max = 10 * 60,
  step = 30,
  hardMax = 24 * 60,
}: {
  label?: string
  value: number
  onChange: (minutes: number) => void
  /** スライダーの右端（分）。既定は10時間 */
  max?: number
  step?: number
  /** 手入力の上限（分）。既定は24時間 */
  hardMax?: number
}) {
  const v = Math.max(0, Math.min(hardMax, Math.round(value)))
  // 値が右端を超えているときは、次の1時間の切りまで右端を広げる
  const sliderMax = v > max ? Math.min(hardMax, Math.ceil(v / 60) * 60) : max
  const set = (n: number) => onChange(Math.max(0, Math.min(hardMax, Number.isFinite(n) ? n : 0)))
  const [editing, setEditing] = useState(false)
  const [h, setH] = useState(Math.floor(v / 60))
  const [m, setM] = useState(v % 60)
  const openEditor = () => {
    setH(Math.floor(v / 60))
    setM(v % 60)
    setEditing(true)
  }
  const commit = () => {
    set((Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0))
    setEditing(false)
  }
  return (
    <div className="field minutes-field">
      <div className="minutes-head">
        {label && <span className="field-label">{label}</span>}
        {editing ? (
          <span className="minutes-edit">
            <input type="number" inputMode="numeric" min={0} max={Math.floor(hardMax / 60)} value={Number.isNaN(h) ? '' : h} onChange={(e) => setH(parseInt(e.target.value, 10))} autoFocus aria-label="時間" />
            <span>時間</span>
            <input type="number" inputMode="numeric" min={0} max={59} value={Number.isNaN(m) ? '' : m} onChange={(e) => setM(parseInt(e.target.value, 10))} aria-label="分" />
            <span>分</span>
            <button type="button" className="btn btn-small btn-primary" onClick={commit}>
              決定
            </button>
          </span>
        ) : (
          <button type="button" className="minutes-value" onClick={openEditor} aria-label={`${formatMinutes(v)}。タップして手入力`}>
            {formatMinutes(v)}
            <span className="minutes-value-hint">✎</span>
          </button>
        )}
      </div>
      <div className="minutes-slider">
        <button type="button" className="step-btn" onClick={() => set(v - step)} disabled={v <= 0} aria-label={`${step}分減らす`}>
          −
        </button>
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={step}
          value={Math.round(v / step) * step}
          onChange={(e) => set(parseInt(e.target.value, 10))}
          aria-label={label ?? '時間'}
          aria-valuetext={formatMinutes(v)}
          style={{ ['--pct' as string]: `${(v / sliderMax) * 100}%` }}
        />
        <button type="button" className="step-btn" onClick={() => set(v + step)} disabled={v >= sliderMax} aria-label={`${step}分増やす`}>
          ＋
        </button>
      </div>
    </div>
  )
}
