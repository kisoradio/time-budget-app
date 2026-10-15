import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../domain/time'

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

/** 分数を「時間」「分」の2つの入力で編集する */
export function MinutesField({ label, value, onChange }: { label?: string; value: number; onChange: (minutes: number) => void }) {
  const h = Math.floor(Math.max(0, value) / 60)
  const m = Math.max(0, value) % 60
  const set = (hh: number, mm: number) => onChange(Math.max(0, (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0)))
  return (
    <div className="field minutes-field">
      {label && <span className="field-label">{label}</span>}
      <span className="minutes-inputs">
        <input type="number" inputMode="numeric" min={0} max={48} value={h} onChange={(e) => set(parseInt(e.target.value, 10), m)} />
        <span>時間</span>
        <input type="number" inputMode="numeric" min={0} max={59} step={5} value={m} onChange={(e) => set(h, parseInt(e.target.value, 10))} />
        <span>分</span>
      </span>
    </div>
  )
}
