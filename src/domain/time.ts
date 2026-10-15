import type { IsoUtc } from './types'

export const MINUTE = 60_000
export const HOUR = 3_600_000

export function toMs(iso: IsoUtc): number {
  return new Date(iso).getTime()
}

export function toIso(ms: number | Date): IsoUtc {
  return new Date(ms).toISOString()
}

export function nowIso(): IsoUtc {
  return new Date().toISOString()
}

/** ミリ秒を分（切り捨て）に */
export function msToMinutes(ms: number): number {
  return Math.floor(ms / MINUTE)
}

/** 分を「H:MM」表記に。負の値は "-H:MM"。 */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(minutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${sign}${h}:${m.toString().padStart(2, '0')}`
}

/** ミリ秒を「H:MM」表記に（分単位に切り捨て） */
export function formatMs(ms: number): string {
  return formatMinutes(msToMinutes(ms))
}

/** 端末タイムゾーンでの時刻 "HH:MM" */
export function formatClock(iso: IsoUtc): string {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/** 端末タイムゾーンでの日付 "M/D" */
export function formatMonthDay(iso: IsoUtc): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 端末タイムゾーンでの "M/D HH:MM" */
export function formatDateTime(iso: IsoUtc): string {
  return `${formatMonthDay(iso)} ${formatClock(iso)}`
}

/** 端末タイムゾーンでの日付キー "YYYY-MM-DD"（サイクルの日付の判定に使う） */
export function localDateKey(iso: IsoUtc): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** <input type="datetime-local"> 用の値（端末タイムゾーン）に変換 */
export function toDatetimeLocalValue(iso: IsoUtc): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** <input type="datetime-local"> の値（端末タイムゾーン）を UTC の ISO に変換 */
export function fromDatetimeLocalValue(value: string): IsoUtc | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return null
  return toIso(ms)
}
