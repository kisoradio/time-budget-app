import { describe, it, expect } from 'vitest'
import { formatMinutes, formatMs, fromDatetimeLocalValue, toDatetimeLocalValue, localDateKey } from './time'

describe('時刻の表記', () => {
  it('H:MM 形式で表示する（§15）', () => {
    expect(formatMinutes(0)).toBe('0:00')
    expect(formatMinutes(80)).toBe('1:20')
    expect(formatMinutes(1500)).toBe('25:00')
    expect(formatMinutes(-30)).toBe('-0:30')
    expect(formatMs(90 * 60_000 + 29_000)).toBe('1:30')
    expect(formatMs(3 * 60 * 60_000 - 500)).toBe('3:00')
  })

  it('datetime-local の値と UTC を往復できる', () => {
    const iso = '2026-10-14T22:30:00.000Z' // JST 10/15 07:30
    expect(toDatetimeLocalValue(iso)).toBe('2026-10-15T07:30')
    expect(fromDatetimeLocalValue('2026-10-15T07:30')).toBe(iso)
    expect(fromDatetimeLocalValue('')).toBeNull()
  })

  it('日付キーは端末タイムゾーン', () => {
    expect(localDateKey('2026-10-14T22:30:00.000Z')).toBe('2026-10-15')
  })
})
